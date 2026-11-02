package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type loadThresholds struct {
	Name                     string
	SyntheticConcurrency     int
	MinimumRequestsPerSecond float64
	ReadP95MS                int
	WriteP95MS               int
	ErrorRatePercent         float64
	MinimumDuration          time.Duration
}

type loadReport struct {
	SchemaVersion      string            `json:"schema_version"`
	GeneratedAt        string            `json:"generated_at"`
	Outcome            string            `json:"outcome"`
	Certified          bool              `json:"certified"`
	Profile            string            `json:"profile"`
	Concurrency        int               `json:"concurrency"`
	DurationSeconds    float64           `json:"duration_seconds"`
	Requests           uint64            `json:"requests"`
	ReadRequests       uint64            `json:"read_requests"`
	WriteRequests      uint64            `json:"write_requests"`
	Errors             uint64            `json:"errors"`
	ErrorRatePercent   float64           `json:"error_rate_percent"`
	RequestsPerSecond  float64           `json:"requests_per_second"`
	P50MS              int64             `json:"p50_ms"`
	P95MS              int64             `json:"p95_ms"`
	P99MS              int64             `json:"p99_ms"`
	ReadP95MS          int64             `json:"read_p95_ms"`
	WriteP95MS         int64             `json:"write_p95_ms"`
	CertificationNotes []string          `json:"certification_notes"`
	CertificationScope string            `json:"certification_scope"`
	ErrorReasons       map[string]uint64 `json:"error_reasons,omitempty"`
}

type latencyHistogram struct {
	mu      sync.Mutex
	buckets [60_001]uint64
	count   uint64
}

func (histogram *latencyHistogram) observe(duration time.Duration) {
	milliseconds := duration.Milliseconds()
	if milliseconds < 0 {
		milliseconds = 0
	}
	if milliseconds > 60_000 {
		milliseconds = 60_000
	}
	histogram.mu.Lock()
	histogram.buckets[milliseconds]++
	histogram.count++
	histogram.mu.Unlock()
}

func (histogram *latencyHistogram) percentile(percent float64) int64 {
	histogram.mu.Lock()
	defer histogram.mu.Unlock()
	if histogram.count == 0 {
		return 0
	}
	target := uint64(float64(histogram.count)*percent + 0.999999)
	if target == 0 {
		target = 1
	}
	var cumulative uint64
	for milliseconds, count := range histogram.buckets {
		cumulative += count
		if cumulative >= target {
			return int64(milliseconds)
		}
	}
	return 60_000
}

type loadOptions struct {
	SiteURL         string
	Secret          string
	ExpectedRelease string
	Concurrency     int
	Duration        time.Duration
	RequestInterval time.Duration
	WritePercent    int
	Timeout         time.Duration
	Thresholds      loadThresholds
	Certify         bool
	Client          *http.Client
}

func runLoad(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("load", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	siteURL := flags.String("site-url", strings.TrimSpace(envOrEmpty("CONVEX_SITE_URL")), "Convex HTTP action origin")
	profileName := flags.String("profile", "launch", "capacity profile from production/scale-targets.json")
	targetsFile := flags.String("targets", "production/scale-targets.json", "capacity target file")
	concurrency := flags.Int("concurrency", 10, "virtual users in this process")
	duration := flags.Duration("duration", 10*time.Second, "test duration")
	requestInterval := flags.Duration("request-interval", time.Second, "minimum interval per virtual user")
	writePercent := flags.Int("write-percent", 10, "percentage of write probes")
	timeout := flags.Duration("timeout", 10*time.Second, "per-request timeout")
	certify := boolFlag(flags, "certify", false, "require full profile concurrency and duration")
	confirm := boolFlag(flags, "confirm-production-load", false, "confirm that an external target may receive load")
	allowHTTP := boolFlag(flags, "allow-http", false, "allow loopback HTTP")
	jsonMode := boolFlag(flags, "json", false, "emit JSON")
	if err := flags.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if flags.NArg() != 0 {
		return &usageError{message: "load does not accept positional arguments"}
	}
	if *siteURL == "" {
		return &usageError{message: "set --site-url or CONVEX_SITE_URL"}
	}
	if err := validateProbeOrigin(*siteURL, *allowHTTP); err != nil {
		return &usageError{message: "site URL: " + err.Error()}
	}
	if !isLoopbackOrigin(*siteURL) && !*confirm {
		return &usageError{message: "external load requires --confirm-production-load"}
	}
	if *concurrency < 1 || *concurrency > 50_000 {
		return &usageError{message: "concurrency must be between 1 and 50000"}
	}
	if *duration < time.Second || *requestInterval < 0 || *writePercent < 0 || *writePercent > 100 {
		return &usageError{message: "duration, request interval, or write percentage is invalid"}
	}
	secret := strings.TrimSpace(os.Getenv("OPENBOOK_SYNTHETIC_KEY"))
	if len(secret) < 32 {
		return &usageError{message: "OPENBOOK_SYNTHETIC_KEY must contain at least 32 characters"}
	}
	thresholds, err := loadProfile(*targetsFile, *profileName)
	if err != nil {
		return err
	}
	report := executeLoad(loadOptions{
		SiteURL: strings.TrimRight(*siteURL, "/"), Secret: secret,
		ExpectedRelease: strings.TrimSpace(envOrEmpty("OPENBOOK_RELEASE")),
		Concurrency:     *concurrency, Duration: *duration, RequestInterval: *requestInterval,
		WritePercent: *writePercent, Timeout: *timeout, Thresholds: thresholds,
		Certify: *certify,
	})
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("synthetic load probe failed")
	}
	return nil
}

func isLoopbackOrigin(raw string) bool {
	return strings.HasPrefix(raw, "http://127.0.0.1") ||
		strings.HasPrefix(raw, "http://localhost") || strings.HasPrefix(raw, "http://[::1]")
}

func loadProfile(path, name string) (loadThresholds, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return loadThresholds{}, fmt.Errorf("read load targets: %w", err)
	}
	var targets scaleTargets
	if err := json.Unmarshal(body, &targets); err != nil {
		return loadThresholds{}, fmt.Errorf("decode load targets: %w", err)
	}
	for _, profile := range targets.Profiles {
		if profile.Name == name {
			return loadThresholds{
				Name:                     profile.Name,
				SyntheticConcurrency:     profile.SyntheticConcurrency,
				MinimumRequestsPerSecond: profile.MinimumRequestsPerSecond,
				ReadP95MS:                profile.ReadP95MS,
				WriteP95MS:               profile.WriteP95MS,
				ErrorRatePercent:         profile.ErrorRatePercent,
				MinimumDuration:          time.Duration(profile.MinimumLoadTestMinutes) * time.Minute,
			}, nil
		}
	}
	return loadThresholds{}, fmt.Errorf("load profile %q not found", name)
}

type loadAccumulator struct {
	requests  uint64
	reads     uint64
	writes    uint64
	errors    uint64
	all       latencyHistogram
	read      latencyHistogram
	write     latencyHistogram
	reasonsMu sync.Mutex
	reasons   map[string]uint64
}

func (accumulator *loadAccumulator) recordError(reason string) {
	atomic.AddUint64(&accumulator.errors, 1)
	accumulator.reasonsMu.Lock()
	if accumulator.reasons == nil {
		accumulator.reasons = map[string]uint64{}
	}
	accumulator.reasons[reason]++
	accumulator.reasonsMu.Unlock()
}

func executeLoad(options loadOptions) loadReport {
	client := options.Client
	if client == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.MaxIdleConns = options.Concurrency
		transport.MaxIdleConnsPerHost = options.Concurrency
		client = &http.Client{Transport: transport, Timeout: options.Timeout}
	}
	started := time.Now()
	deadline := started.Add(options.Duration)
	var sequence uint64
	accumulator := &loadAccumulator{}
	var workers sync.WaitGroup
	for worker := 0; worker < options.Concurrency; worker++ {
		workers.Add(1)
		go func(workerID int) {
			defer workers.Done()
			for time.Now().Before(deadline) {
				iterationStarted := time.Now()
				current := atomic.AddUint64(&sequence, 1)
				operation := "read"
				if int(current%100) < options.WritePercent {
					operation = "write"
				}
				nonce := fmt.Sprintf("%d-%d-%d", started.UnixMilli(), workerID, current)
				payload, _ := json.Marshal(map[string]string{"operation": operation, "nonce": nonce})
				requestContext, cancel := context.WithTimeout(context.Background(), options.Timeout)
				request, err := http.NewRequestWithContext(requestContext, http.MethodPost, options.SiteURL+"/ops/load", bytes.NewReader(payload))
				if err == nil {
					request.Header.Set("Authorization", "Bearer "+options.Secret)
					request.Header.Set("Content-Type", "application/json")
					request.Header.Set("User-Agent", "openbookctl/"+toolVersion)
				}
				requestStarted := time.Now()
				response, requestErr := func() (*http.Response, error) {
					if err != nil {
						return nil, err
					}
					return client.Do(request)
				}()
				failureReason := ""
				if requestErr != nil {
					failureReason = "transport"
				}
				if response != nil {
					var result struct {
						OK        bool   `json:"ok"`
						Operation string `json:"operation"`
						Release   string `json:"release"`
					}
					decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8<<10)).Decode(&result)
					_ = response.Body.Close()
					if response.StatusCode != http.StatusOK {
						failureReason = fmt.Sprintf("http_%d", response.StatusCode)
					} else if decodeErr != nil {
						failureReason = "decode"
					} else if !result.OK {
						failureReason = "not_ok"
					} else if result.Operation != operation {
						failureReason = "operation_mismatch"
					} else if options.ExpectedRelease != "" && result.Release != options.ExpectedRelease {
						failureReason = "release_mismatch"
					}
				}
				latency := time.Since(requestStarted)
				cancel()
				atomic.AddUint64(&accumulator.requests, 1)
				if operation == "write" {
					atomic.AddUint64(&accumulator.writes, 1)
					accumulator.write.observe(latency)
				} else {
					atomic.AddUint64(&accumulator.reads, 1)
					accumulator.read.observe(latency)
				}
				accumulator.all.observe(latency)
				if failureReason != "" {
					accumulator.recordError(failureReason)
				}
				remaining := options.RequestInterval - time.Since(iterationStarted)
				if remaining > 0 && time.Now().Add(remaining).Before(deadline) {
					time.Sleep(remaining)
				}
			}
		}(worker)
	}
	workers.Wait()
	elapsed := time.Since(started)
	requests := atomic.LoadUint64(&accumulator.requests)
	errors := atomic.LoadUint64(&accumulator.errors)
	errorRate := 0.0
	if requests > 0 {
		errorRate = float64(errors) * 100 / float64(requests)
	}
	report := loadReport{
		SchemaVersion: reportSchemaVersion, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Outcome: "pass", Profile: options.Thresholds.Name, Concurrency: options.Concurrency,
		CertificationScope: "synthetic_http",
		DurationSeconds:    elapsed.Seconds(), Requests: requests,
		ReadRequests: atomic.LoadUint64(&accumulator.reads), WriteRequests: atomic.LoadUint64(&accumulator.writes),
		Errors: errors, ErrorRatePercent: errorRate,
		RequestsPerSecond: float64(requests) / elapsed.Seconds(),
		P50MS:             accumulator.all.percentile(0.50), P95MS: accumulator.all.percentile(0.95),
		P99MS: accumulator.all.percentile(0.99), ReadP95MS: accumulator.read.percentile(0.95),
		WriteP95MS:   accumulator.write.percentile(0.95),
		ErrorReasons: accumulator.reasons,
	}
	if requests == 0 || report.ReadRequests == 0 || report.WriteRequests == 0 {
		report.Outcome = "fail"
	}
	if errorRate > options.Thresholds.ErrorRatePercent || report.ReadP95MS > int64(options.Thresholds.ReadP95MS) || report.WriteP95MS > int64(options.Thresholds.WriteP95MS) {
		report.Outcome = "fail"
	}
	if options.Certify {
		if options.Concurrency < options.Thresholds.SyntheticConcurrency {
			report.CertificationNotes = append(report.CertificationNotes, "synthetic concurrency is below the profile target")
		}
		if options.Duration < options.Thresholds.MinimumDuration {
			report.CertificationNotes = append(report.CertificationNotes, "duration is below the profile minimum")
		}
		if report.RequestsPerSecond < options.Thresholds.MinimumRequestsPerSecond {
			report.CertificationNotes = append(report.CertificationNotes, "request rate is below the profile target")
		}
		if len(report.CertificationNotes) > 0 {
			report.Outcome = "fail"
		} else if report.Outcome == "pass" {
			report.Certified = true
		}
	} else {
		report.CertificationNotes = []string{"smoke measurement only; rerun with --certify at full profile coverage"}
	}
	sort.Strings(report.CertificationNotes)
	return report
}
