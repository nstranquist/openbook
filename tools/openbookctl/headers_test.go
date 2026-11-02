package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderSecurityHeaders(t *testing.T) {
	file := filepath.Join(t.TempDir(), "_headers")
	template := "script-src " + clerkOriginPlaceholder + "\nconnect-src " + clerkOriginPlaceholder + " " + convexOriginPlaceholder + " " + convexSiteOriginPlaceholder + " " + convexWebSocketOriginPlaceholder + "\nimg-src " + convexSiteOriginPlaceholder + "\nmedia-src " + convexSiteOriginPlaceholder + "\n"
	if err := os.WriteFile(file, []byte(template), 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runHeaders([]string{
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
	if strings.Contains(string(body), "__") ||
		strings.Count(string(body), "https://clerk.openbook.test") != 2 ||
		strings.Count(string(body), "https://openbook.convex.cloud") != 1 ||
		strings.Count(string(body), "https://openbook.convex.site") != 3 ||
		strings.Count(string(body), "wss://openbook.convex.cloud") != 1 {
		t.Fatalf("rendered headers = %q", body)
	}
}

func TestRenderSecurityHeadersRejectsUnsafeOrigin(t *testing.T) {
	file := filepath.Join(t.TempDir(), "_headers")
	template := clerkOriginPlaceholder + clerkOriginPlaceholder + convexOriginPlaceholder + strings.Repeat(convexSiteOriginPlaceholder, 3) + convexWebSocketOriginPlaceholder
	if err := os.WriteFile(file, []byte(template), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := runHeaders([]string{
		"--file", file,
		"--clerk-origin", "https://user:secret@example.test",
		"--convex-origin", "https://openbook.convex.cloud",
		"--convex-site-origin", "https://openbook.convex.site",
	}, io.Discard); err == nil {
		t.Fatal("unsafe origin passed")
	}
}
