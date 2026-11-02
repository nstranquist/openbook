package main

import (
	"flag"
	"fmt"
	"io"
)

type tauriProductionConfig struct {
	App struct {
		Security struct {
			CSP map[string]string `json:"csp"`
		} `json:"security"`
	} `json:"app"`
}

func runDesktopConfig(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("desktop-config", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	file := fs.String("file", "", "generated Tauri production config")
	clerkOrigin := fs.String("clerk-origin", "", "Clerk production Frontend API origin")
	convexOrigin := fs.String("convex-origin", "", "Convex production application origin")
	convexSiteOrigin := fs.String("convex-site-origin", "", "Convex production HTTP-action origin")
	if err := fs.Parse(args); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 || *file == "" || *clerkOrigin == "" || *convexOrigin == "" || *convexSiteOrigin == "" {
		return &usageError{message: "desktop-config requires --file, --clerk-origin, --convex-origin, and --convex-site-origin"}
	}
	clerk, _, err := parseProductionOrigin("--clerk-origin", *clerkOrigin)
	if err != nil {
		return err
	}
	convex, convexURL, err := parseProductionOrigin("--convex-origin", *convexOrigin)
	if err != nil {
		return err
	}
	convexSite, _, err := parseProductionOrigin("--convex-site-origin", *convexSiteOrigin)
	if err != nil {
		return err
	}
	websocketURL := *convexURL
	websocketURL.Scheme = "wss"
	websocket := websocketURL.String()

	var config tauriProductionConfig
	config.App.Security.CSP = productionDesktopCSP(clerk, convex, convexSite, websocket)
	if err := writePrivateJSON(*file, config); err != nil {
		return fmt.Errorf("write Tauri production config: %w", err)
	}
	fmt.Fprintln(stdout, "Rendered exact production provider origins into the Tauri CSP.")
	return nil
}

func productionDesktopCSP(clerk, convex, convexSite, websocket string) map[string]string {
	return map[string]string{
		"default-src":     "'self' customprotocol:",
		"script-src":      "'self' " + clerk + " https://challenges.cloudflare.com https://*.protect.clerk.com",
		"style-src":       "'self' 'unsafe-inline'",
		"connect-src":     "ipc: http://ipc.localhost " + clerk + " " + convex + " " + convexSite + " " + websocket,
		"img-src":         "'self' data: blob: https://img.clerk.com " + convexSite,
		"media-src":       "'self' blob: " + convexSite,
		"font-src":        "'self' data:",
		"frame-src":       "'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
		"frame-ancestors": "'none'",
		"object-src":      "'none'",
		"base-uri":        "'self'",
		"form-action":     "'self'",
		"manifest-src":    "'self'",
		"worker-src":      "'self' blob:",
	}
}
