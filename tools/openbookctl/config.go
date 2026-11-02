package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const reportSchemaVersion = "1.0.0"

type checkResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type readinessReport struct {
	SchemaVersion string        `json:"schema_version"`
	GeneratedAt   string        `json:"generated_at"`
	Outcome       string        `json:"outcome"`
	Checks        []checkResult `json:"checks"`
}

type environment interface {
	LookupEnv(string) (string, bool)
}

type processEnvironment struct{}

func (processEnvironment) LookupEnv(key string) (string, bool) { return os.LookupEnv(key) }

type mapEnvironment map[string]string

func (m mapEnvironment) LookupEnv(key string) (string, bool) {
	v, ok := m[key]
	return v, ok
}

func envValue(env environment, key string) string {
	value, _ := env.LookupEnv(key)
	return strings.TrimSpace(value)
}

func runReadiness(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("readiness", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	jsonMode := boolFlag(fs, "json", false, "emit JSON")
	online := boolFlag(fs, "online", false, "verify configured providers over the network")
	if err := fs.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 {
		return &usageError{message: "readiness does not accept positional arguments"}
	}
	report := checkEnvironment(processEnvironment{})
	if *online && report.Outcome != "fail" {
		report.Checks = append(report.Checks, checkStripeProvider(processEnvironment{}))
		report.Outcome = outcomeOf(report.Checks)
	}
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("production environment is not ready")
	}
	return nil
}

func checkEnvironment(env environment) readinessReport {
	checks := make([]checkResult, 0, 24)
	add := func(name, status, message string) {
		checks = append(checks, checkResult{Name: name, Status: status, Message: message})
	}

	if envValue(env, "OPENBOOK_ENV") == "production" {
		add("environment", "pass", "OPENBOOK_ENV is production")
	} else {
		add("environment", "fail", "Set OPENBOOK_ENV=production")
	}
	checkHTTPSOrigin := func(key string) {
		value := envValue(env, key)
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
			add(key, "fail", "Set a bare HTTPS origin without credentials, a path, or a query")
			return
		}
		add(key, "pass", "HTTPS origin is configured")
	}
	checkHTTPSOrigin("SITE_URL")
	checkHTTPSOrigin("VITE_CONVEX_URL")
	checkHTTPSOrigin("CONVEX_SITE_URL")
	checkHTTPSOrigin("VITE_CONVEX_SITE_URL")
	checkHTTPSOrigin("CLERK_JWT_ISSUER_DOMAIN")
	if envValue(env, "VITE_CONVEX_SITE_URL") != envValue(env, "CONVEX_SITE_URL") {
		add("site origin parity", "fail", "VITE_CONVEX_SITE_URL must match CONVEX_SITE_URL")
	} else {
		add("site origin parity", "pass", "Web and backend HTTP-action origins match")
	}
	if envValue(env, "OPENBOOK_AUTH_MODE") != "clerk" || envValue(env, "VITE_OPENBOOK_AUTH_MODE") != "clerk" {
		add("authentication mode", "fail", "Production requires OPENBOOK_AUTH_MODE=clerk and VITE_OPENBOOK_AUTH_MODE=clerk")
	} else if !strings.HasPrefix(envValue(env, "CLERK_SECRET_KEY"), "sk_live_") || !strings.HasPrefix(envValue(env, "VITE_CLERK_PUBLISHABLE_KEY"), "pk_live_") {
		add("authentication mode", "fail", "Production Clerk keys must be live keys")
	} else {
		add("authentication mode", "pass", "Stable Clerk authentication is configured")
	}

	release := envValue(env, "OPENBOOK_RELEASE")
	if !releasePattern.MatchString(release) || release == "unknown" {
		add("release", "fail", "Set OPENBOOK_RELEASE to the immutable deployed revision")
	} else {
		add("release", "pass", "An immutable release identifier is configured")
	}

	mediaSecret := envValue(env, "MEDIA_SIGNING_SECRET")
	if len(mediaSecret) < 32 || mediaSecret == envValue(env, "SITE_URL") {
		add("media signing", "fail", "Set an independent MEDIA_SIGNING_SECRET with at least 32 characters")
	} else {
		add("media signing", "pass", "The independent media signing secret meets the minimum length")
	}

	operators := splitNonEmpty(envValue(env, "OPERATOR_USER_IDS"))
	if len(operators) == 0 {
		add("operators", "fail", "Set at least one OPERATOR_USER_IDS value")
	} else {
		add("operators", "pass", fmt.Sprintf("%d operator identifier(s) configured", len(operators)))
	}
	if len(envValue(env, "OPENBOOK_SYNTHETIC_KEY")) < 32 {
		add("synthetic load key", "fail", "Set OPENBOOK_SYNTHETIC_KEY to an independent value with at least 32 characters")
	} else {
		add("synthetic load key", "pass", "The production load endpoint has an independent key")
	}
	if len(envValue(env, "CLIENT_ERROR_HASH_SECRET")) < 32 {
		add("client error hash", "fail", "Set CLIENT_ERROR_HASH_SECRET to an independent value with at least 32 characters")
	} else {
		add("client error hash", "pass", "Client source addresses are keyed before rate-limit storage")
	}

	provider := envValue(env, "EMAIL_PROVIDER")
	emailFrom := envValue(env, "EMAIL_FROM")
	if provider != "resend" {
		add("email provider", "fail", "Production currently requires EMAIL_PROVIDER=resend")
	} else if envValue(env, "RESEND_API_KEY") == "" {
		add("email provider", "fail", "Set RESEND_API_KEY for password recovery and verification")
	} else if emailFrom == "" || strings.Contains(emailFrom, "onboarding@resend.dev") {
		add("email provider", "fail", "Set EMAIL_FROM to a verified production sender")
	} else {
		add("email provider", "pass", "Resend and a production sender are configured")
	}

	billingMode := envValue(env, "OPENBOOK_BILLING_MODE")
	switch billingMode {
	case "disabled":
		add("billing", "pass", "Billing is explicitly disabled")
	case "live":
		if strings.HasPrefix(envValue(env, "STRIPE_SECRET_KEY"), "sk_live_") && envValue(env, "STRIPE_WEBHOOK_SECRET") != "" && strings.HasPrefix(envValue(env, "STRIPE_PRICE_PRO"), "price_") {
			add("billing", "pass", "Live Stripe key, webhook secret, and price are configured")
		} else {
			add("billing", "fail", "Live billing requires sk_live_, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_PRO")
		}
	default:
		add("billing", "fail", "Set OPENBOOK_BILLING_MODE to live or disabled")
	}

	pushMode := envValue(env, "OPENBOOK_PUSH_MODE")
	switch pushMode {
	case "disabled":
		add("web push", "pass", "Web push is explicitly disabled")
	case "enabled":
		if envValue(env, "VAPID_PUBLIC_KEY") == "" || envValue(env, "VAPID_PRIVATE_KEY") == "" || envValue(env, "VAPID_SUBJECT") == "" {
			add("web push", "fail", "Enabled web push requires both VAPID keys and VAPID_SUBJECT")
		} else {
			add("web push", "pass", "Web push keys and subject are configured")
		}
	default:
		add("web push", "fail", "Set OPENBOOK_PUSH_MODE to enabled or disabled")
	}

	capacityProfile := envValue(env, "OPENBOOK_CAPACITY_PROFILE")
	if capacityProfile != "launch" && capacityProfile != "scale" {
		add("capacity profile", "fail", "Set OPENBOOK_CAPACITY_PROFILE to launch or scale")
	} else {
		add("capacity profile", "pass", fmt.Sprintf("The %s profile is selected", capacityProfile))
	}
	backupPolicy := envValue(env, "OPENBOOK_BACKUP_POLICY")
	if capacityProfile == "scale" && backupPolicy != "hourly" {
		add("backup policy", "fail", "The scale profile requires OPENBOOK_BACKUP_POLICY=hourly")
	} else if capacityProfile == "launch" && backupPolicy != "daily" && backupPolicy != "hourly" {
		add("backup policy", "fail", "The launch profile requires OPENBOOK_BACKUP_POLICY=daily or hourly")
	} else if backupPolicy == "daily" || backupPolicy == "hourly" {
		add("backup policy", "pass", fmt.Sprintf("The %s backup policy is acknowledged", backupPolicy))
	} else {
		add("backup policy", "fail", "Enable and verify the backup policy for the selected capacity profile")
	}
	if envValue(env, "OPENBOOK_OBSERVABILITY_MODE") == "provider-log-stream" {
		add("observability", "pass", "Provider log streaming is acknowledged")
	} else {
		add("observability", "fail", "Set OPENBOOK_OBSERVABILITY_MODE=provider-log-stream after the stream is verified")
	}

	errorURL := envValue(env, "VITE_OPENBOOK_ERROR_REPORT_URL")
	parsedErrorURL, err := url.Parse(errorURL)
	expectedErrorURL := strings.TrimRight(envValue(env, "CONVEX_SITE_URL"), "/") + "/client-errors"
	if err != nil || parsedErrorURL.Scheme != "https" || parsedErrorURL.Host == "" || errorURL != expectedErrorURL {
		add("client errors", "fail", "Set VITE_OPENBOOK_ERROR_REPORT_URL to CONVEX_SITE_URL/client-errors")
	} else {
		add("client errors", "pass", "Client error ingestion is configured")
	}

	if envValue(env, "VITE_OPENBOOK_DEV_LOGIN") == "1" || envValue(env, "VITE_OPENBOOK_AUTO_LOGIN") == "1" {
		add("development login", "fail", "Disable development login flags in production")
	} else {
		add("development login", "pass", "Development login flags are disabled")
	}

	sort.SliceStable(checks, func(i, j int) bool {
		if checks[i].Status == checks[j].Status {
			return checks[i].Name < checks[j].Name
		}
		return severity(checks[i].Status) > severity(checks[j].Status)
	})
	return readinessReport{
		SchemaVersion: reportSchemaVersion,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		Outcome:       outcomeOf(checks),
		Checks:        checks,
	}
}

func checkStripeProvider(env environment) checkResult {
	if envValue(env, "OPENBOOK_BILLING_MODE") == "disabled" {
		return checkResult{Name: "Stripe API", Status: "pass", Message: "Billing is disabled"}
	}
	key := envValue(env, "STRIPE_SECRET_KEY")
	price := envValue(env, "STRIPE_PRICE_PRO")
	if key == "" || price == "" {
		return checkResult{Name: "Stripe API", Status: "fail", Message: "Stripe credentials are incomplete"}
	}
	ctxClient := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, "https://api.stripe.com/v1/prices/"+url.PathEscape(price), nil)
	if err != nil {
		return checkResult{Name: "Stripe API", Status: "fail", Message: "Cannot create the Stripe request"}
	}
	req.Header.Set("Authorization", "Bearer "+key)
	response, err := ctxClient.Do(req)
	if err != nil {
		return checkResult{Name: "Stripe API", Status: "fail", Message: "Stripe is not reachable"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return checkResult{Name: "Stripe API", Status: "fail", Message: fmt.Sprintf("Stripe returned HTTP %d", response.StatusCode)}
	}
	var body struct {
		Active   bool   `json:"active"`
		Type     string `json:"type"`
		Livemode bool   `json:"livemode"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body); err != nil {
		return checkResult{Name: "Stripe API", Status: "fail", Message: "Stripe returned invalid JSON"}
	}
	if !body.Active || body.Type != "recurring" || !body.Livemode {
		return checkResult{Name: "Stripe API", Status: "fail", Message: "The configured price is not active, recurring, and live"}
	}
	return checkResult{Name: "Stripe API", Status: "pass", Message: "The live recurring price is active"}
}

func splitNonEmpty(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func severity(status string) int {
	switch status {
	case "fail":
		return 3
	case "warn":
		return 2
	default:
		return 1
	}
}

func outcomeOf(checks []checkResult) string {
	outcome := "pass"
	for _, check := range checks {
		if check.Status == "fail" {
			return "fail"
		}
		if check.Status == "warn" {
			outcome = "warn"
		}
	}
	return outcome
}

var releasePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{6,127}$`)

type scaleTargets struct {
	SchemaVersion string `json:"schema_version"`
	Profiles      []struct {
		Name                     string  `json:"name"`
		ConvexClass              string  `json:"convex_class"`
		ProviderSessionLimit     int     `json:"provider_session_limit"`
		TargetConcurrentSessions int     `json:"target_concurrent_sessions"`
		SyntheticConcurrency     int     `json:"synthetic_concurrency"`
		MinimumRequestsPerSecond float64 `json:"minimum_requests_per_second"`
		ReadP95MS                int     `json:"read_p95_ms"`
		WriteP95MS               int     `json:"write_p95_ms"`
		ErrorRatePercent         float64 `json:"error_rate_percent"`
		AvailabilityPercent      float64 `json:"availability_percent"`
		MinimumLoadTestMinutes   int     `json:"minimum_load_test_minutes"`
		MaximumBackupAgeHours    int     `json:"maximum_backup_age_hours"`
		RecoveryTimeMinutes      int     `json:"recovery_time_objective_minutes"`
	} `json:"profiles"`
}

type targetsReport struct {
	SchemaVersion string        `json:"schema_version"`
	Outcome       string        `json:"outcome"`
	Checks        []checkResult `json:"checks"`
}

func runTargets(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("targets", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	file := fs.String("file", "production/scale-targets.json", "capacity target file")
	jsonMode := boolFlag(fs, "json", false, "emit JSON")
	if err := fs.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 {
		return &usageError{message: "targets does not accept positional arguments"}
	}
	report, err := validateTargets(*file)
	if err != nil {
		return err
	}
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("production targets are invalid")
	}
	return nil
}

func validateTargets(path string) (targetsReport, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return targetsReport{}, fmt.Errorf("read targets: %w", err)
	}
	var targets scaleTargets
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&targets); err != nil {
		return targetsReport{}, fmt.Errorf("decode targets: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return targetsReport{}, fmt.Errorf("decode targets: trailing JSON content")
	}
	checks := []checkResult{}
	add := func(name, status, message string) {
		checks = append(checks, checkResult{Name: name, Status: status, Message: message})
	}
	if targets.SchemaVersion == "1.2.0" {
		add("schema", "pass", "Target schema is 1.2.0")
	} else {
		add("schema", "fail", "schema_version must be 1.2.0")
	}
	if len(targets.Profiles) < 2 {
		add("profiles", "fail", "Define at least launch and scale profiles")
	}
	seen := map[string]bool{}
	for _, profile := range targets.Profiles {
		name := "profile " + profile.Name
		if profile.Name == "" || seen[profile.Name] {
			add(name, "fail", "Profile names must be present and unique")
			continue
		}
		seen[profile.Name] = true
		if profile.ConvexClass == "" || profile.ProviderSessionLimit <= 0 || profile.TargetConcurrentSessions <= 0 || profile.TargetConcurrentSessions > profile.ProviderSessionLimit || profile.SyntheticConcurrency <= 0 || profile.MinimumRequestsPerSecond <= 0 || profile.ReadP95MS <= 0 || profile.WriteP95MS <= 0 || profile.ErrorRatePercent <= 0 || profile.AvailabilityPercent < 90 || profile.AvailabilityPercent > 100 || profile.MinimumLoadTestMinutes <= 0 || profile.MaximumBackupAgeHours <= 0 || profile.RecoveryTimeMinutes <= 0 {
			add(name, "fail", "Capacity and SLO values must be positive and bounded")
			continue
		}
		add(name, "pass", fmt.Sprintf("%s targets %d sessions and %d synthetic workers", profile.ConvexClass, profile.TargetConcurrentSessions, profile.SyntheticConcurrency))
	}
	for _, required := range []string{"launch", "scale"} {
		if !seen[required] {
			add("profile "+required, "fail", "The required capacity profile is missing")
		}
	}
	return targetsReport{SchemaVersion: reportSchemaVersion, Outcome: outcomeOf(checks), Checks: checks}, nil
}
