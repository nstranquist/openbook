// Command license-audit fails when Openbook's production dependency tree
// contains an unreviewed license family or an unpublished @nicos dependency.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
)

type packageInfo struct {
	Name     string   `json:"name"`
	Versions []string `json:"versions"`
}

var approved = map[string]bool{
	"MIT": true, "ISC": true, "Apache-2.0": true,
	"BSD-3-Clause": true, "0BSD": true,
}

func main() {
	cmd := exec.Command("pnpm", "licenses", "list", "--prod", "--json")
	raw, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintln(os.Stderr, "license audit: pnpm licenses list failed:", err)
		fmt.Fprintln(os.Stderr, strings.TrimSpace(string(raw)))
		fmt.Fprintln(os.Stderr, "hint: run `pnpm install` so package index metadata is present")
		os.Exit(1)
	}
	licenses, err := parsePnpmLicenses(raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, "license audit:", err)
		os.Exit(1)
	}
	if err := verify(licenses); err != nil {
		fmt.Fprintln(os.Stderr, "license audit:", err)
		os.Exit(1)
	}
	keys := make([]string, 0, len(licenses))
	for license := range licenses {
		keys = append(keys, license)
	}
	sort.Strings(keys)
	for _, license := range keys {
		fmt.Printf("ok  %-12s %d packages\n", license, len(licenses[license]))
	}
}

// parsePnpmLicenses decodes pnpm licenses --json output and fails closed when
// pnpm embeds an error object (common when package index metadata is missing).
func parsePnpmLicenses(raw []byte) (map[string][]packageInfo, error) {
	var maybeErr struct {
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &maybeErr) == nil && maybeErr.Error != nil {
		return nil, fmt.Errorf("pnpm error %s: %s (hint: run `pnpm install` so package index metadata is present)", maybeErr.Error.Code, maybeErr.Error.Message)
	}
	licenses := map[string][]packageInfo{}
	if err := json.Unmarshal(raw, &licenses); err != nil {
		return nil, fmt.Errorf("parse pnpm output: %w", err)
	}
	return licenses, nil
}

func verify(licenses map[string][]packageInfo) error {
	if len(licenses) == 0 {
		return fmt.Errorf("pnpm returned no production dependency licenses")
	}
	for license, packages := range licenses {
		if !approved[license] {
			return fmt.Errorf("unreviewed license %q", license)
		}
		for _, pkg := range packages {
			if strings.HasPrefix(pkg.Name, "@nicos/") {
				return fmt.Errorf("unpublished external dependency %s", pkg.Name)
			}
		}
	}
	return nil
}
