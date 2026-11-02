package main

import (
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const clerkOriginPlaceholder = "__CLERK_FAPI_ORIGIN__"
const convexOriginPlaceholder = "__CONVEX_ORIGIN__"
const convexSiteOriginPlaceholder = "__CONVEX_SITE_ORIGIN__"
const convexWebSocketOriginPlaceholder = "__CONVEX_WS_ORIGIN__"

func runHeaders(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("headers", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	file := fs.String("file", "", "generated Cloudflare _headers file")
	clerkOrigin := fs.String("clerk-origin", "", "Clerk production Frontend API origin")
	convexOrigin := fs.String("convex-origin", "", "Convex production application origin")
	convexSiteOrigin := fs.String("convex-site-origin", "", "Convex production HTTP-action origin")
	if err := fs.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 || *file == "" || *clerkOrigin == "" || *convexOrigin == "" || *convexSiteOrigin == "" {
		return &usageError{message: "headers requires --file, --clerk-origin, --convex-origin, and --convex-site-origin"}
	}
	clerk, clerkURL, err := parseProductionOrigin("--clerk-origin", *clerkOrigin)
	if err != nil {
		return err
	}
	_ = clerkURL
	convex, convexURL, err := parseProductionOrigin("--convex-origin", *convexOrigin)
	if err != nil {
		return err
	}
	convexSite, _, err := parseProductionOrigin("--convex-site-origin", *convexSiteOrigin)
	if err != nil {
		return err
	}
	convexURL.Scheme = "wss"
	convexWebSocket := convexURL.String()
	info, err := os.Stat(*file)
	if err != nil {
		return fmt.Errorf("read headers template: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return fmt.Errorf("headers template must be a regular file smaller than 1 MiB")
	}
	body, err := os.ReadFile(*file)
	if err != nil {
		return fmt.Errorf("read headers template: %w", err)
	}
	template := string(body)
	for _, expected := range []struct {
		placeholder string
		count       int
	}{
		{clerkOriginPlaceholder, 2},
		{convexOriginPlaceholder, 1},
		{convexSiteOriginPlaceholder, 3},
		{convexWebSocketOriginPlaceholder, 1},
	} {
		if strings.Count(template, expected.placeholder) != expected.count {
			return fmt.Errorf("headers template has an invalid %s placeholder count", expected.placeholder)
		}
	}
	rendered := template
	for placeholder, origin := range map[string]string{
		clerkOriginPlaceholder:           clerk,
		convexOriginPlaceholder:          convex,
		convexSiteOriginPlaceholder:      convexSite,
		convexWebSocketOriginPlaceholder: convexWebSocket,
	} {
		rendered = strings.ReplaceAll(rendered, placeholder, origin)
	}
	directory := filepath.Dir(*file)
	temporary, err := os.CreateTemp(directory, ".openbook-headers-*")
	if err != nil {
		return fmt.Errorf("create rendered headers: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		temporary.Close()
		return fmt.Errorf("set rendered headers mode: %w", err)
	}
	if _, err := temporary.WriteString(rendered); err != nil {
		temporary.Close()
		return fmt.Errorf("write rendered headers: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close rendered headers: %w", err)
	}
	if err := os.Rename(temporaryName, *file); err != nil {
		return fmt.Errorf("install rendered headers: %w", err)
	}
	fmt.Fprintln(stdout, "Rendered the exact Clerk and Convex origins into the generated security headers.")
	return nil
}

func parseProductionOrigin(name, raw string) (string, *url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", nil, &usageError{message: name + " must be a bare HTTPS origin"}
	}
	parsed.Path = ""
	return strings.TrimRight(parsed.String(), "/"), parsed, nil
}
