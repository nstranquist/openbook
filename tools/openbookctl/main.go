package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const toolVersion = "0.2.0"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		printUsage(stdout)
		return 0
	}
	if args[0] == "version" {
		fmt.Fprintf(stdout, "openbookctl %s\n", toolVersion)
		return 0
	}

	var err error
	switch args[0] {
	case "readiness":
		err = runReadiness(args[1:], stdout)
	case "probe":
		err = runProbe(args[1:], stdout)
	case "backup":
		err = runBackup(args[1:], stdout)
	case "targets":
		err = runTargets(args[1:], stdout)
	case "audit":
		err = runAudit(args[1:], stdout)
	case "load":
		err = runLoad(args[1:], stdout)
	case "headers":
		err = runHeaders(args[1:], stdout)
	case "desktop-config":
		err = runDesktopConfig(args[1:], stdout)
	default:
		err = fmt.Errorf("unknown command %q", args[0])
	}
	if err == nil {
		return 0
	}
	var usageErr *usageError
	if errors.As(err, &usageErr) {
		fmt.Fprintf(stderr, "openbookctl: %s\n", usageErr.Error())
		return 2
	}
	fmt.Fprintf(stderr, "openbookctl: %s\n", err)
	return 1
}

type usageError struct{ message string }

func (e *usageError) Error() string { return e.message }

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage: openbookctl <command> [flags]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Commands:")
	fmt.Fprintln(w, "  readiness   Validate the production environment without printing secrets")
	fmt.Fprintln(w, "  probe       Probe the web origin and Convex health endpoints")
	fmt.Fprintln(w, "  backup      Verify a Convex backup ZIP file")
	fmt.Fprintln(w, "  targets     Validate the production capacity and SLO contract")
	fmt.Fprintln(w, "  audit       Reject unbounded backend reads and missing edge controls")
	fmt.Fprintln(w, "  load        Run a bounded synthetic read/write load probe")
	fmt.Fprintln(w, "  headers     Render exact production provider origins into edge headers")
	fmt.Fprintln(w, "  desktop-config Render exact production provider origins into a Tauri config")
	fmt.Fprintln(w, "  version     Print the tool version")
}

func writeReport(w io.Writer, value any, jsonMode bool) error {
	if jsonMode {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(value)
	}
	switch report := value.(type) {
	case readinessReport:
		fmt.Fprintf(w, "Openbook production readiness: %s\n", strings.ToUpper(report.Outcome))
		for _, check := range report.Checks {
			fmt.Fprintf(w, "  %-5s %-28s %s\n", strings.ToUpper(check.Status), check.Name, check.Message)
		}
	case probeReport:
		fmt.Fprintf(w, "Openbook production probe: %s\n", strings.ToUpper(report.Outcome))
		for _, check := range report.Checks {
			fmt.Fprintf(w, "  %-5s %-28s %s (%s)\n", strings.ToUpper(check.Status), check.Name, check.Message, time.Duration(check.DurationMS)*time.Millisecond)
		}
	case backupReport:
		fmt.Fprintf(w, "Openbook backup: %s\n", strings.ToUpper(report.Outcome))
		fmt.Fprintf(w, "  sha256: %s\n", report.SHA256)
		fmt.Fprintf(w, "  tables: %d; files: %d; bytes: %d\n", report.TableCount, report.StorageFileCount, report.SizeBytes)
		for _, missing := range report.MissingTables {
			fmt.Fprintf(w, "  FAIL  missing table              %s\n", missing)
		}
	case targetsReport:
		fmt.Fprintf(w, "Openbook production targets: %s\n", strings.ToUpper(report.Outcome))
		for _, check := range report.Checks {
			fmt.Fprintf(w, "  %-5s %-28s %s\n", strings.ToUpper(check.Status), check.Name, check.Message)
		}
	case auditReport:
		fmt.Fprintf(w, "Openbook production source audit: %s\n", strings.ToUpper(report.Outcome))
		for _, finding := range report.Findings {
			fmt.Fprintf(w, "  FAIL  %-28s %s:%d %s\n", finding.Rule, finding.File, finding.Line, finding.Message)
		}
		if len(report.Findings) == 0 {
			fmt.Fprintf(w, "  PASS  bounded backend reads and edge controls are present\n")
		}
	case loadReport:
		fmt.Fprintf(w, "Openbook synthetic load probe: %s\n", strings.ToUpper(report.Outcome))
		fmt.Fprintf(w, "  requests=%d errors=%d rps=%.1f p50=%s p95=%s p99=%s\n",
			report.Requests, report.Errors, report.RequestsPerSecond,
			time.Duration(report.P50MS)*time.Millisecond,
			time.Duration(report.P95MS)*time.Millisecond,
			time.Duration(report.P99MS)*time.Millisecond)
	default:
		return fmt.Errorf("unsupported report type %T", value)
	}
	return nil
}

func boolFlag(fs *flag.FlagSet, name string, defaultValue bool, usage string) *bool {
	return fs.Bool(name, defaultValue, usage)
}
