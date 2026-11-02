package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExecuteLoadMeasuresReadsAndWrites(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var body struct {
			Operation string `json:"operation"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"ok":true,"operation":%q,"release":"release-test"}`, body.Operation)
	}))
	defer server.Close()
	report := executeLoad(loadOptions{
		SiteURL: server.URL, Secret: "secret", ExpectedRelease: "release-test",
		Concurrency: 4, Duration: 120 * time.Millisecond, RequestInterval: 5 * time.Millisecond,
		WritePercent: 20, Timeout: time.Second,
		Thresholds: loadThresholds{Name: "test", ReadP95MS: 1000, WriteP95MS: 1000, ErrorRatePercent: 1},
	})
	if report.Outcome != "pass" || report.ReadRequests == 0 || report.WriteRequests == 0 || report.Errors != 0 {
		t.Fatalf("report = %#v", report)
	}
}

func TestExecuteLoadFailsReleaseMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"operation":"read","release":"wrong"}`))
	}))
	defer server.Close()
	report := executeLoad(loadOptions{
		SiteURL: server.URL, Secret: "secret", ExpectedRelease: "expected",
		Concurrency: 1, Duration: 20 * time.Millisecond, WritePercent: 0, Timeout: time.Second,
		Thresholds: loadThresholds{Name: "test", ReadP95MS: 1000, WriteP95MS: 1000, ErrorRatePercent: 1},
	})
	if report.Outcome != "fail" || report.Errors == 0 {
		t.Fatalf("report = %#v", report)
	}
}
