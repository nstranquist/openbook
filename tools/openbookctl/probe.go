package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type probeCheck struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	DurationMS int64  `json:"duration_ms"`
	StatusCode int    `json:"status_code,omitempty"`
}

type probeReport struct {
	SchemaVersion string       `json:"schema_version"`
	GeneratedAt   string       `json:"generated_at"`
	Outcome       string       `json:"outcome"`
	Checks        []probeCheck `json:"checks"`
}

type healthPayload struct {
	OK              bool   `json:"ok"`
	Service         string `json:"service"`
	Environment     string `json:"environment"`
	Release         string `json:"release"`
	Database        *bool  `json:"database,omitempty"`
	Maintenance     *bool  `json:"maintenance,omitempty"`
	Delivery        *bool  `json:"delivery,omitempty"`
	AccountDeletion *bool  `json:"accountDeletion,omitempty"`
	Migrations      *bool  `json:"migrations,omitempty"`
	Configuration   *bool  `json:"configuration,omitempty"`
}

func runProbe(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("probe", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	webURL := fs.String("web-url", "", "public web origin; defaults to SITE_URL")
	siteURL := fs.String("site-url", "", "Convex HTTP action origin; defaults to CONVEX_SITE_URL")
	expectedRelease := fs.String("release", "", "expected immutable release; defaults to OPENBOOK_RELEASE")
	timeout := fs.Duration("timeout", 10*time.Second, "request timeout")
	maxLatency := fs.Duration("max-latency", 2*time.Second, "maximum latency for each endpoint")
	allowHTTP := boolFlag(fs, "allow-http", false, "allow loopback HTTP for local verification")
	strictHeaders := boolFlag(fs, "strict-headers", true, "require production web security headers")
	jsonMode := boolFlag(fs, "json", false, "emit JSON")
	if err := fs.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 {
		return &usageError{message: "probe does not accept positional arguments"}
	}
	if *webURL == "" {
		*webURL = strings.TrimSpace(envOrEmpty("SITE_URL"))
	}
	if *siteURL == "" {
		*siteURL = strings.TrimSpace(envOrEmpty("CONVEX_SITE_URL"))
	}
	if *expectedRelease == "" {
		*expectedRelease = strings.TrimSpace(envOrEmpty("OPENBOOK_RELEASE"))
	}
	if *webURL == "" || *siteURL == "" {
		return &usageError{message: "set --web-url and --site-url, or set SITE_URL and CONVEX_SITE_URL"}
	}
	for name, raw := range map[string]string{"web URL": *webURL, "site URL": *siteURL} {
		if err := validateProbeOrigin(raw, *allowHTTP); err != nil {
			return &usageError{message: fmt.Sprintf("%s: %s", name, err)}
		}
	}
	report := executeProbe(probeOptions{
		WebURL:          strings.TrimRight(*webURL, "/"),
		SiteURL:         strings.TrimRight(*siteURL, "/"),
		ExpectedRelease: *expectedRelease,
		Timeout:         *timeout,
		MaxLatency:      *maxLatency,
		StrictHeaders:   *strictHeaders,
	})
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("production probe failed")
	}
	return nil
}

func envOrEmpty(key string) string {
	value, _ := processEnvironment{}.LookupEnv(key)
	return value
}

func validateProbeOrigin(raw string, allowHTTP bool) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("must be an origin without credentials, a query, or a fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return fmt.Errorf("must not contain a path")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if allowHTTP && parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1") {
		return nil
	}
	return fmt.Errorf("must use HTTPS; only loopback HTTP is allowed with --allow-http")
}

type probeOptions struct {
	WebURL          string
	SiteURL         string
	ExpectedRelease string
	Timeout         time.Duration
	MaxLatency      time.Duration
	StrictHeaders   bool
	Client          *http.Client
}

func executeProbe(options probeOptions) probeReport {
	client := options.Client
	if client == nil {
		client = &http.Client{
			Timeout: options.Timeout,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				if len(via) > 0 && request.URL.Host != via[0].URL.Host {
					return fmt.Errorf("cross-origin redirect")
				}
				return nil
			},
		}
	}
	checks := []probeCheck{}
	checks = append(checks, probeWeb(client, options))
	checks = append(checks, probeHealth(client, options, "/health", false))
	checks = append(checks, probeHealth(client, options, "/ready", true))
	outcome := "pass"
	for _, check := range checks {
		if check.Status == "fail" {
			outcome = "fail"
			break
		}
		if check.Status == "warn" {
			outcome = "warn"
		}
	}
	return probeReport{
		SchemaVersion: reportSchemaVersion,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		Outcome:       outcome,
		Checks:        checks,
	}
}

func probeWeb(client *http.Client, options probeOptions) probeCheck {
	started := time.Now()
	response, err := doGet(client, options.WebURL+"/status", options.Timeout)
	duration := time.Since(started)
	if err != nil {
		return probeCheck{Name: "web status", Status: "fail", Message: sanitizeProbeError(err), DurationMS: duration.Milliseconds()}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return probeCheck{Name: "web status", Status: "fail", Message: fmt.Sprintf("HTTP %d", response.StatusCode), StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if duration > options.MaxLatency {
		return probeCheck{Name: "web status", Status: "fail", Message: fmt.Sprintf("Latency %s exceeds %s", duration.Round(time.Millisecond), options.MaxLatency), StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	required := []string{
		"Content-Security-Policy",
		"Permissions-Policy",
		"Referrer-Policy",
		"Strict-Transport-Security",
		"X-Content-Type-Options",
		"X-Frame-Options",
	}
	var missing []string
	for _, header := range required {
		if strings.TrimSpace(response.Header.Get(header)) == "" {
			missing = append(missing, header)
		}
	}
	if len(missing) > 0 {
		status := "warn"
		if options.StrictHeaders {
			status = "fail"
		}
		return probeCheck{Name: "web status", Status: status, Message: "Missing headers: " + strings.Join(missing, ", "), StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	return probeCheck{Name: "web status", Status: "pass", Message: "Status route and security headers are available", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
}

func probeHealth(client *http.Client, options probeOptions, path string, requireDependencies bool) probeCheck {
	started := time.Now()
	response, err := doGet(client, options.SiteURL+path, options.Timeout)
	duration := time.Since(started)
	name := strings.TrimPrefix(path, "/")
	if err != nil {
		return probeCheck{Name: name, Status: "fail", Message: sanitizeProbeError(err), DurationMS: duration.Milliseconds()}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return probeCheck{Name: name, Status: "fail", Message: fmt.Sprintf("HTTP %d", response.StatusCode), StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if duration > options.MaxLatency {
		return probeCheck{Name: name, Status: "fail", Message: fmt.Sprintf("Latency %s exceeds %s", duration.Round(time.Millisecond), options.MaxLatency), StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	var payload healthPayload
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&payload); err != nil {
		return probeCheck{Name: name, Status: "fail", Message: "Response is not valid health JSON", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if !payload.OK || payload.Service != "openbook" {
		return probeCheck{Name: name, Status: "fail", Message: "Service did not report ok", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if options.ExpectedRelease != "" && payload.Release != options.ExpectedRelease {
		return probeCheck{Name: name, Status: "fail", Message: "Release does not match OPENBOOK_RELEASE", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if requireDependencies && (payload.Database == nil || !*payload.Database || payload.Maintenance == nil || !*payload.Maintenance || payload.Delivery == nil || !*payload.Delivery || payload.AccountDeletion == nil || !*payload.AccountDeletion || payload.Migrations == nil || !*payload.Migrations || payload.Configuration == nil || !*payload.Configuration) {
		return probeCheck{Name: name, Status: "fail", Message: "A required readiness dependency is missing or unhealthy", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	if !strings.Contains(strings.ToLower(response.Header.Get("Cache-Control")), "no-store") {
		return probeCheck{Name: name, Status: "fail", Message: "Cache-Control must include no-store", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
	}
	return probeCheck{Name: name, Status: "pass", Message: "Endpoint is ready", StatusCode: response.StatusCode, DurationMS: duration.Milliseconds()}
}

func doGet(client *http.Client, rawURL string, timeout time.Duration) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json,text/html;q=0.9")
	request.Header.Set("User-Agent", "openbookctl/"+toolVersion)
	return client.Do(request)
}

func sanitizeProbeError(err error) string {
	message := err.Error()
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}
