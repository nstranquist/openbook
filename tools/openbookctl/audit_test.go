package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeAuditFixture(t *testing.T, root, relative, body string) {
	t.Helper()
	path := filepath.Join(root, relative)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestAuditSourceRejectsUnboundedReads(t *testing.T) {
	root := t.TempDir()
	writeAuditFixture(t, root, "convex/feed.ts", `ctx.db.query("posts").collect()`)
	writeAuditFixture(t, root, "apps/web/public/_headers", auditHeadersFixture())
	writeAuditFixture(t, root, "apps/web/public/_redirects", "/* /index.html 200\n")
	writeAuditFixture(t, root, "scripts/build-desktop.sh", auditDesktopFixture())
	report, err := auditSource(root)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "fail" || len(report.Findings) != 1 || report.Findings[0].Rule != "unbounded-collect" {
		t.Fatalf("report = %#v", report)
	}
}

func TestAuditSourceAcceptsBoundedReadsAndEdgeFiles(t *testing.T) {
	root := t.TempDir()
	writeAuditFixture(t, root, "convex/feed.ts", `ctx.db.query("posts").withIndex("by_created").take(20)`)
	writeAuditFixture(t, root, "apps/web/public/_headers", auditHeadersFixture())
	writeAuditFixture(t, root, "apps/web/public/_redirects", "/* /index.html 200\n")
	writeAuditFixture(t, root, "scripts/build-desktop.sh", auditDesktopFixture())
	report, err := auditSource(root)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "pass" || len(report.Findings) != 0 {
		t.Fatalf("report = %#v", report)
	}
}

func auditHeadersFixture() string {
	return "Content-Security-Policy\nStrict-Transport-Security\nX-Content-Type-Options\n" +
		clerkOriginPlaceholder + "\n" + convexOriginPlaceholder + "\n" +
		convexSiteOriginPlaceholder + "\n" + convexWebSocketOriginPlaceholder + "\n"
}

func auditDesktopFixture() string {
	return "desktop-config --clerk-origin value --convex-origin value --convex-site-origin value --config file\n"
}
