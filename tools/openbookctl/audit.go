package main

import (
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type auditFinding struct {
	Rule    string `json:"rule"`
	File    string `json:"file"`
	Line    int    `json:"line"`
	Message string `json:"message"`
}

type auditReport struct {
	SchemaVersion string         `json:"schema_version"`
	Outcome       string         `json:"outcome"`
	FilesScanned  int            `json:"files_scanned"`
	Findings      []auditFinding `json:"findings"`
}

var databaseFilterPattern = regexp.MustCompile(`(?s)\.filter\(\s*\(?\s*(?:q|query)\s*\)?\s*=>`)
var directCriticalActionPattern = regexp.MustCompile(`(?s)scheduler\.runAfter\(.{0,300}?internal\.(?:emails\.sendEmail|pushSend\.sendToUser)`)

func runAudit(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("audit", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	root := flags.String("root", ".", "repository root")
	jsonMode := boolFlag(flags, "json", false, "emit JSON")
	if err := flags.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if flags.NArg() != 0 {
		return &usageError{message: "audit does not accept positional arguments"}
	}
	report, err := auditSource(*root)
	if err != nil {
		return err
	}
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("production source audit failed")
	}
	return nil
}

func auditSource(root string) (auditReport, error) {
	report := auditReport{SchemaVersion: reportSchemaVersion, Outcome: "pass"}
	convexRoot := filepath.Join(root, "convex")
	err := filepath.WalkDir(convexRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == "_generated" {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".test.ts") || name == "test.setup.ts" {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		report.FilesScanned++
		rel, _ := filepath.Rel(root, path)
		text := string(body)
		add := func(rule, needle, message string) {
			start := 0
			for {
				index := strings.Index(text[start:], needle)
				if index < 0 {
					return
				}
				absolute := start + index
				report.Findings = append(report.Findings, auditFinding{
					Rule: rule, File: filepath.ToSlash(rel),
					Line: 1 + strings.Count(text[:absolute], "\n"), Message: message,
				})
				start = absolute + len(needle)
			}
		}
		add("unbounded-collect", ".collect(", "Use an index with paginate, take, first, or unique")
		for _, match := range databaseFilterPattern.FindAllStringIndex(text, -1) {
			report.Findings = append(report.Findings, auditFinding{
				Rule: "database-filter", File: filepath.ToSlash(rel),
				Line:    1 + strings.Count(text[:match[0]], "\n"),
				Message: "Use a database index instead of Query.filter",
			})
		}
		for _, match := range directCriticalActionPattern.FindAllStringIndex(text, -1) {
			report.Findings = append(report.Findings, auditFinding{
				Rule: "direct-critical-action", File: filepath.ToSlash(rel),
				Line:    1 + strings.Count(text[:match[0]], "\n"),
				Message: "Route critical provider calls through the durable delivery outbox",
			})
		}
		return nil
	})
	if err != nil {
		return auditReport{}, fmt.Errorf("audit Convex source: %w", err)
	}

	for _, required := range []struct {
		path    string
		needles []string
	}{
		{filepath.Join(root, "apps", "web", "public", "_headers"), []string{"Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", clerkOriginPlaceholder, convexOriginPlaceholder, convexSiteOriginPlaceholder, convexWebSocketOriginPlaceholder}},
		{filepath.Join(root, "apps", "web", "public", "_redirects"), []string{"/index.html", "200"}},
		{filepath.Join(root, "scripts", "build-desktop.sh"), []string{"desktop-config", "--clerk-origin", "--convex-origin", "--convex-site-origin", "--config"}},
	} {
		body, err := os.ReadFile(required.path)
		if err != nil {
			rel, _ := filepath.Rel(root, required.path)
			report.Findings = append(report.Findings, auditFinding{Rule: "edge-control", File: filepath.ToSlash(rel), Line: 1, Message: "Required production edge file is missing"})
			continue
		}
		for _, needle := range required.needles {
			if !strings.Contains(string(body), needle) {
				rel, _ := filepath.Rel(root, required.path)
				report.Findings = append(report.Findings, auditFinding{Rule: "edge-control", File: filepath.ToSlash(rel), Line: 1, Message: "Missing " + needle})
			}
		}
		if strings.HasSuffix(required.path, "_headers") && strings.Contains(string(body), "*.convex.") {
			rel, _ := filepath.Rel(root, required.path)
			report.Findings = append(report.Findings, auditFinding{Rule: "edge-control", File: filepath.ToSlash(rel), Line: 1, Message: "Use exact Convex origins instead of a wildcard"})
		}
	}
	sort.Slice(report.Findings, func(i, j int) bool {
		if report.Findings[i].File == report.Findings[j].File {
			return report.Findings[i].Line < report.Findings[j].Line
		}
		return report.Findings[i].File < report.Findings[j].File
	})
	if len(report.Findings) > 0 {
		report.Outcome = "fail"
	}
	return report, nil
}
