package main

import "testing"

func TestSafeRelative(t *testing.T) {
	for _, path := range []string{"README.md", "apps/web/src/main.tsx", ".github/workflows/ci.yml"} {
		if !safeRelative(path) {
			t.Fatalf("safeRelative(%q) = false", path)
		}
	}
	for _, path := range []string{"", "../secret", "apps/../README.md", "/tmp/file"} {
		if safeRelative(path) {
			t.Fatalf("safeRelative(%q) = true", path)
		}
	}
}

func TestWithin(t *testing.T) {
	if !within("/repo", "/repo/export") {
		t.Fatal("expected nested output to be detected")
	}
	if within("/repo", "/other/export") {
		t.Fatal("unexpected nested-output match")
	}
}
