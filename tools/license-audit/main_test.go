package main

import (
	"strings"
	"testing"
)

func TestVerifyAcceptsCurrentLicenseFamilies(t *testing.T) {
	err := verify(map[string][]packageInfo{
		"MIT":        {{Name: "react", Versions: []string{"19.2.3"}}},
		"Apache-2.0": {{Name: "convex", Versions: []string{"1.39.0"}}},
		"MPL-2.0":    {{Name: "web-push", Versions: []string{"3.6.7"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRejectsUnknownAndUnpublishedDependencies(t *testing.T) {
	for name, licenses := range map[string]map[string][]packageInfo{
		"unknown": {"AGPL-3.0": {{Name: "x"}}},
		"nicos":   {"MIT": {{Name: "@nicos/private-package"}}},
	} {
		if err := verify(licenses); err == nil {
			t.Fatalf("%s dependency set passed", name)
		}
	}
}

func TestParsePnpmLicensesRejectsErrorObject(t *testing.T) {
	raw := []byte(`{"error":{"code":"ERR_PNPM_MISSING_PACKAGE_INDEX_FILE","message":"please consider running 'pnpm install'"}}`)
	got, err := parsePnpmLicenses(raw)
	if err == nil || got != nil {
		t.Fatalf("expected error for pnpm error object, got %#v err=%v", got, err)
	}
	if !strings.Contains(err.Error(), "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE") {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(err.Error(), "pnpm install") {
		t.Fatalf("expected install hint, got %v", err)
	}
}

func TestParsePnpmLicensesAcceptsLicenseMap(t *testing.T) {
	raw := []byte(`{"MIT":[{"name":"react","versions":["19.2.3"]}]}`)
	got, err := parsePnpmLicenses(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(got["MIT"]) != 1 || got["MIT"][0].Name != "react" {
		t.Fatalf("got %#v", got)
	}
}
