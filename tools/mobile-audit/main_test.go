package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestVerifyAuditAcceptsReviewedMetroAdvisories(t *testing.T) {
	report := decodeAudit(t, `{
		"auditReportVersion": 2,
		"vulnerabilities": {
			"expo": {"name":"expo","isDirect":true,"via":["metro"]},
			"metro": {"name":"metro","via":["image-size","metro-config"]},
			"metro-config": {"name":"metro-config","via":["metro"]},
			"image-size": {
				"name":"image-size","severity":"high","isDirect":false,
				"effects":["metro"],"nodes":["node_modules/image-size"],
				"via":[
					{"name":"image-size","dependency":"image-size","url":"https://github.com/advisories/GHSA-w3rx-r6r6-pgpr","severity":"high","range":"<=2.0.2"},
					{"name":"image-size","dependency":"image-size","url":"https://github.com/advisories/GHSA-5p2g-fcmc-qvqq","severity":"high","range":"<=2.0.2"}
				]
			}
		}
	}`)

	got, err := verifyAudit(report, time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d advisories, want 2", len(got))
	}
}

func TestVerifyAuditRejectsUnexpectedAndExpiredFindings(t *testing.T) {
	unexpected := decodeAudit(t, `{
		"auditReportVersion":2,
		"vulnerabilities":{
			"image-size":{
				"name":"image-size","effects":["metro"],"nodes":["node_modules/image-size"],
				"via":[{"name":"image-size","dependency":"image-size","url":"https://github.com/advisories/NEW","severity":"high","range":"<=2.0.2"}]
			}
		}
	}`)
	if _, err := verifyAudit(unexpected, time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)); err == nil || !strings.Contains(err.Error(), "unreviewed advisory") {
		t.Fatalf("expected unreviewed-advisory error, got %v", err)
	}

	reviewed := decodeAudit(t, `{
		"auditReportVersion":2,
		"vulnerabilities":{
			"image-size":{
				"name":"image-size","effects":["metro"],"nodes":["node_modules/image-size"],
				"via":[{"name":"image-size","dependency":"image-size","url":"https://github.com/advisories/GHSA-w3rx-r6r6-pgpr","severity":"high","range":"<=2.0.2"}]
			}
		}
	}`)
	if _, err := verifyAudit(reviewed, time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expiry error, got %v", err)
	}
}

func TestVerifyDependencyTreeRequiresExactBuildPath(t *testing.T) {
	good := dependencyNode{Dependencies: map[string]dependencyNode{
		"expo": {Version: "57.0.15", Dependencies: map[string]dependencyNode{
			"@expo/metro": {Version: "56.0.0", Dependencies: map[string]dependencyNode{
				"metro": {Version: "0.84.4", Dependencies: map[string]dependencyNode{
					"image-size": {Version: imageSizeVersion},
				}},
			}},
		}},
	}}
	if err := verifyDependencyTree(good); err != nil {
		t.Fatal(err)
	}

	bad := dependencyNode{Dependencies: map[string]dependencyNode{
		"runtime-uploader": {Version: "1.0.0", Dependencies: map[string]dependencyNode{
			"image-size": {Version: imageSizeVersion},
		}},
	}}
	if err := verifyDependencyTree(bad); err == nil || !strings.Contains(err.Error(), "reviewed path") {
		t.Fatalf("expected path error, got %v", err)
	}
}

func decodeAudit(t *testing.T, raw string) auditReport {
	t.Helper()
	var report auditReport
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		t.Fatal(err)
	}
	return report
}
