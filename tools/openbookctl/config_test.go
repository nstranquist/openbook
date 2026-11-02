package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func productionEnvironment() mapEnvironment {
	return mapEnvironment{
		"OPENBOOK_ENV":                   "production",
		"SITE_URL":                       "https://openbook.example.com",
		"VITE_CONVEX_URL":                "https://api.openbook.example.com",
		"CONVEX_SITE_URL":                "https://actions.openbook.example.com",
		"VITE_CONVEX_SITE_URL":           "https://actions.openbook.example.com",
		"OPENBOOK_AUTH_MODE":             "clerk",
		"VITE_OPENBOOK_AUTH_MODE":        "clerk",
		"CLERK_JWT_ISSUER_DOMAIN":        "https://clerk.openbook.example.com",
		"CLERK_SECRET_KEY":               "sk_live_secret",
		"VITE_CLERK_PUBLISHABLE_KEY":     "pk_live_public",
		"OPENBOOK_RELEASE":               "5edf7d184dfebd64",
		"MEDIA_SIGNING_SECRET":           "0123456789abcdef0123456789abcdef",
		"OPERATOR_USER_IDS":              "user_one",
		"OPENBOOK_SYNTHETIC_KEY":         "0123456789abcdef0123456789abcdef",
		"CLIENT_ERROR_HASH_SECRET":       "abcdef0123456789abcdef0123456789",
		"EMAIL_PROVIDER":                 "resend",
		"RESEND_API_KEY":                 "re_test",
		"EMAIL_FROM":                     "Openbook <mail@example.com>",
		"OPENBOOK_BILLING_MODE":          "disabled",
		"OPENBOOK_PUSH_MODE":             "disabled",
		"OPENBOOK_CAPACITY_PROFILE":      "launch",
		"OPENBOOK_BACKUP_POLICY":         "daily",
		"OPENBOOK_OBSERVABILITY_MODE":    "provider-log-stream",
		"VITE_OPENBOOK_ERROR_REPORT_URL": "https://actions.openbook.example.com/client-errors",
		"VITE_OPENBOOK_DEV_LOGIN":        "0",
		"VITE_OPENBOOK_AUTO_LOGIN":       "0",
	}
}

func TestCheckEnvironmentRequiresHourlyBackupsAtScale(t *testing.T) {
	env := productionEnvironment()
	env["OPENBOOK_CAPACITY_PROFILE"] = "scale"
	report := checkEnvironment(env)
	if report.Outcome != "fail" {
		t.Fatalf("outcome = %s", report.Outcome)
	}
	env["OPENBOOK_BACKUP_POLICY"] = "hourly"
	report = checkEnvironment(env)
	if report.Outcome != "pass" {
		t.Fatalf("outcome = %s; checks = %#v", report.Outcome, report.Checks)
	}
}

func TestCheckEnvironmentPassesExplicitProductionContract(t *testing.T) {
	report := checkEnvironment(productionEnvironment())
	if report.Outcome != "pass" {
		t.Fatalf("outcome = %s; checks = %#v", report.Outcome, report.Checks)
	}
}

func TestCheckEnvironmentFailsClosed(t *testing.T) {
	env := productionEnvironment()
	delete(env, "MEDIA_SIGNING_SECRET")
	env["SITE_URL"] = "http://localhost:5173"
	env["VITE_OPENBOOK_DEV_LOGIN"] = "1"
	report := checkEnvironment(env)
	if report.Outcome != "fail" {
		t.Fatalf("outcome = %s", report.Outcome)
	}
	failed := map[string]bool{}
	for _, check := range report.Checks {
		if check.Status == "fail" {
			failed[check.Name] = true
		}
	}
	for _, name := range []string{"SITE_URL", "media signing", "development login"} {
		if !failed[name] {
			t.Fatalf("missing failure for %s: %#v", name, report.Checks)
		}
	}
}

func TestValidateTargets(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "targets.json")
	body := map[string]any{
		"schema_version": "1.2.0",
		"profiles": []map[string]any{
			{"name": "launch", "convex_class": "S256", "provider_session_limit": 10000, "target_concurrent_sessions": 1000, "synthetic_concurrency": 1000, "minimum_requests_per_second": 500, "read_p95_ms": 500, "write_p95_ms": 750, "error_rate_percent": 1.0, "availability_percent": 99.5, "minimum_load_test_minutes": 15, "maximum_backup_age_hours": 26, "recovery_time_objective_minutes": 240},
			{"name": "scale", "convex_class": "D1024", "provider_session_limit": 100000, "target_concurrent_sessions": 50000, "synthetic_concurrency": 5000, "minimum_requests_per_second": 2500, "read_p95_ms": 300, "write_p95_ms": 500, "error_rate_percent": 0.5, "availability_percent": 99.9, "minimum_load_test_minutes": 60, "maximum_backup_age_hours": 2, "recovery_time_objective_minutes": 60},
		},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := validateTargets(file)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "pass" {
		t.Fatalf("outcome = %s; checks = %#v", report.Outcome, report.Checks)
	}
}
