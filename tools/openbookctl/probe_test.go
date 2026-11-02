package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExecuteProbePassesHealthyDeployment(t *testing.T) {
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" {
			http.NotFound(w, r)
			return
		}
		for name, value := range map[string]string{
			"Content-Security-Policy":   "default-src 'self'",
			"Permissions-Policy":        "camera=()",
			"Referrer-Policy":           "strict-origin-when-cross-origin",
			"Strict-Transport-Security": "max-age=31536000",
			"X-Content-Type-Options":    "nosniff",
			"X-Frame-Options":           "DENY",
		} {
			w.Header().Set(name, value)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer web.Close()

	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		switch r.URL.Path {
		case "/health":
			_, _ = w.Write([]byte(`{"ok":true,"service":"openbook","environment":"test","release":"release-123"}`))
		case "/ready":
			_, _ = w.Write([]byte(`{"ok":true,"service":"openbook","environment":"test","release":"release-123","database":true,"maintenance":true,"delivery":true,"accountDeletion":true,"migrations":true,"configuration":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()

	report := executeProbe(probeOptions{
		WebURL:          web.URL,
		SiteURL:         site.URL,
		ExpectedRelease: "release-123",
		Timeout:         time.Second,
		MaxLatency:      time.Second,
		StrictHeaders:   true,
	})
	if report.Outcome != "pass" {
		t.Fatalf("outcome = %s; checks = %#v", report.Outcome, report.Checks)
	}
}

func TestExecuteProbeFailsMissingHeadersAndDependency(t *testing.T) {
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer web.Close()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/ready" {
			_, _ = w.Write([]byte(`{"ok":true,"service":"openbook","release":"release-123","database":true,"maintenance":false}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"service":"openbook","release":"release-123"}`))
	}))
	defer site.Close()
	report := executeProbe(probeOptions{
		WebURL: web.URL, SiteURL: site.URL, ExpectedRelease: "release-123",
		Timeout: time.Second, MaxLatency: time.Second, StrictHeaders: true,
	})
	if report.Outcome != "fail" {
		t.Fatalf("outcome = %s; checks = %#v", report.Outcome, report.Checks)
	}
}
