package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderDesktopProductionConfig(t *testing.T) {
	file := filepath.Join(t.TempDir(), "tauri.production.json")
	var output bytes.Buffer
	if err := runDesktopConfig([]string{
		"--file", file,
		"--clerk-origin", "https://clerk.openbook.test",
		"--convex-origin", "https://openbook.convex.cloud",
		"--convex-site-origin", "https://openbook.convex.site",
	}, &output); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var config tauriProductionConfig
	if err := json.Unmarshal(body, &config); err != nil {
		t.Fatal(err)
	}
	csp := config.App.Security.CSP
	for _, origin := range []string{
		"https://clerk.openbook.test",
		"https://openbook.convex.cloud",
		"https://openbook.convex.site",
		"wss://openbook.convex.cloud",
	} {
		if !strings.Contains(csp["connect-src"], origin) {
			t.Fatalf("connect-src does not contain %q: %q", origin, csp["connect-src"])
		}
	}
	if strings.Contains(csp["connect-src"], " https: ") || strings.Contains(csp["connect-src"], " wss: ") {
		t.Fatalf("connect-src contains a generic network scheme: %q", csp["connect-src"])
	}
	if csp["object-src"] != "'none'" || csp["frame-ancestors"] != "'none'" {
		t.Fatalf("required Tauri CSP restrictions are missing: %#v", csp)
	}
}

func TestRenderDesktopProductionConfigRejectsUnsafeOrigin(t *testing.T) {
	err := runDesktopConfig([]string{
		"--file", filepath.Join(t.TempDir(), "tauri.production.json"),
		"--clerk-origin", "http://clerk.openbook.test",
		"--convex-origin", "https://openbook.convex.cloud",
		"--convex-site-origin", "https://openbook.convex.site",
	}, io.Discard)
	if err == nil {
		t.Fatal("unsafe origin passed")
	}
}
