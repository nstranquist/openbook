// Command mobile-audit verifies the Expo shell's production dependency audit.
// It fails closed except for reviewed, time-bound build-tool advisories.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"
)

const (
	exceptionExpires = "2026-09-20"
	imageSizeVersion = "1.2.1"
)

var allowedAdvisories = map[string]bool{
	"https://github.com/advisories/GHSA-5p2g-fcmc-qvqq": true,
	"https://github.com/advisories/GHSA-w3rx-r6r6-pgpr": true,
}

type vulnerability struct {
	Name     string            `json:"name"`
	Severity string            `json:"severity"`
	IsDirect bool              `json:"isDirect"`
	Via      []json.RawMessage `json:"via"`
	Effects  []string          `json:"effects"`
	Nodes    []string          `json:"nodes"`
}

type advisory struct {
	Name       string `json:"name"`
	Dependency string `json:"dependency"`
	URL        string `json:"url"`
	Severity   string `json:"severity"`
	Range      string `json:"range"`
}

type auditReport struct {
	AuditReportVersion int                      `json:"auditReportVersion"`
	Vulnerabilities    map[string]vulnerability `json:"vulnerabilities"`
}

type dependencyNode struct {
	Version      string                    `json:"version"`
	Dependencies map[string]dependencyNode `json:"dependencies"`
}

type dependencyPath struct {
	Names    []string
	Versions []string
}

func main() {
	dir := flag.String("dir", "apps/mobile", "directory that contains the mobile package-lock.json")
	flag.Parse()

	report, auditExit, err := runAudit(*dir)
	if err != nil {
		fail(err)
	}
	advisories, err := verifyAudit(report, time.Now().UTC())
	if err != nil {
		fail(err)
	}
	if len(advisories) == 0 {
		if auditExit != 0 {
			fail(fmt.Errorf("npm audit exited %d without vulnerability records", auditExit))
		}
		fmt.Println("mobile audit: PASS (no production vulnerabilities)")
		return
	}
	if auditExit != 1 {
		fail(fmt.Errorf("npm audit exited %d; expected 1 for reviewed findings", auditExit))
	}

	tree, err := runDependencyTree(*dir)
	if err != nil {
		fail(err)
	}
	if err := verifyDependencyTree(tree); err != nil {
		fail(err)
	}

	fmt.Printf(
		"mobile audit: PASS (%d reviewed Metro build-tool advisories; exception expires %s)\n",
		len(advisories),
		exceptionExpires,
	)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "mobile audit:", err)
	os.Exit(1)
}

func runAudit(dir string) (auditReport, int, error) {
	cmd := exec.Command("npm", "audit", "--omit=dev", "--json")
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, runErr := cmd.Output()
	exitCode := 0
	if runErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(runErr, &exitErr) {
			return auditReport{}, 0, fmt.Errorf("run npm audit: %w", runErr)
		}
		exitCode = exitErr.ExitCode()
	}

	var report auditReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return auditReport{}, exitCode, fmt.Errorf("parse npm audit output: %w; stderr: %s", err, strings.TrimSpace(stderr.String()))
	}
	if report.AuditReportVersion != 2 {
		return auditReport{}, exitCode, fmt.Errorf("unsupported npm audit report version %d", report.AuditReportVersion)
	}
	return report, exitCode, nil
}

func runDependencyTree(dir string) (dependencyNode, error) {
	cmd := exec.Command("npm", "ls", "image-size", "--all", "--json")
	cmd.Dir = dir
	raw, err := cmd.CombinedOutput()
	if err != nil {
		return dependencyNode{}, fmt.Errorf("inspect image-size dependency path: %w: %s", err, strings.TrimSpace(string(raw)))
	}
	var root dependencyNode
	if err := json.Unmarshal(raw, &root); err != nil {
		return dependencyNode{}, fmt.Errorf("parse npm dependency tree: %w", err)
	}
	return root, nil
}

func verifyAudit(report auditReport, now time.Time) ([]string, error) {
	if len(report.Vulnerabilities) == 0 {
		return nil, nil
	}

	expires, err := time.Parse("2006-01-02", exceptionExpires)
	if err != nil {
		return nil, fmt.Errorf("parse exception expiry: %w", err)
	}
	if !now.Before(expires.AddDate(0, 0, 1)) {
		return nil, fmt.Errorf("reviewed image-size exception expired on %s", exceptionExpires)
	}

	imageSize, ok := report.Vulnerabilities["image-size"]
	if !ok {
		return nil, fmt.Errorf("vulnerabilities exist without the reviewed image-size finding")
	}
	if imageSize.IsDirect || !sameStrings(imageSize.Effects, []string{"metro"}) || !sameStrings(imageSize.Nodes, []string{"node_modules/image-size"}) {
		return nil, fmt.Errorf("image-size finding is no longer confined to the reviewed Metro path")
	}

	seen := map[string]bool{}
	for name := range report.Vulnerabilities {
		found, err := collectAdvisories(name, report.Vulnerabilities, map[string]bool{})
		if err != nil {
			return nil, err
		}
		if len(found) == 0 {
			return nil, fmt.Errorf("vulnerability %q has no concrete advisory", name)
		}
		for url, item := range found {
			if !allowedAdvisories[url] {
				return nil, fmt.Errorf("unreviewed advisory %s affects %s", url, name)
			}
			if item.Name != "image-size" || item.Dependency != "image-size" || item.Severity != "high" || item.Range != "<=2.0.2" {
				return nil, fmt.Errorf("reviewed advisory %s changed shape", url)
			}
			seen[url] = true
		}
	}

	urls := make([]string, 0, len(seen))
	for url := range seen {
		urls = append(urls, url)
	}
	sort.Strings(urls)
	return urls, nil
}

func collectAdvisories(name string, vulnerabilities map[string]vulnerability, visiting map[string]bool) (map[string]advisory, error) {
	if visiting[name] {
		return map[string]advisory{}, nil
	}
	item, ok := vulnerabilities[name]
	if !ok {
		return nil, fmt.Errorf("audit references missing vulnerability %q", name)
	}
	if len(item.Via) == 0 {
		return nil, fmt.Errorf("vulnerability %q has an empty via list", name)
	}

	nextVisiting := make(map[string]bool, len(visiting)+1)
	for key, value := range visiting {
		nextVisiting[key] = value
	}
	nextVisiting[name] = true

	found := map[string]advisory{}
	for _, raw := range item.Via {
		var dependency string
		if err := json.Unmarshal(raw, &dependency); err == nil {
			children, err := collectAdvisories(dependency, vulnerabilities, nextVisiting)
			if err != nil {
				return nil, err
			}
			for url, child := range children {
				found[url] = child
			}
			continue
		}

		var concrete advisory
		if err := json.Unmarshal(raw, &concrete); err != nil || concrete.URL == "" {
			return nil, fmt.Errorf("vulnerability %q has an invalid via entry", name)
		}
		found[concrete.URL] = concrete
	}
	return found, nil
}

func verifyDependencyTree(root dependencyNode) error {
	paths := findDependencyPaths(root, nil, nil)
	if len(paths) != 1 {
		return fmt.Errorf("expected one image-size path, found %d", len(paths))
	}
	expectedNames := []string{"expo", "@expo/metro", "metro", "image-size"}
	if !sameStrings(paths[0].Names, expectedNames) {
		return fmt.Errorf("image-size moved outside the reviewed path: %s", strings.Join(paths[0].Names, " > "))
	}
	if len(paths[0].Versions) != len(expectedNames) || paths[0].Versions[len(paths[0].Versions)-1] != imageSizeVersion {
		return fmt.Errorf("image-size version changed from reviewed version %s", imageSizeVersion)
	}
	return nil
}

func findDependencyPaths(node dependencyNode, names, versions []string) []dependencyPath {
	keys := make([]string, 0, len(node.Dependencies))
	for name := range node.Dependencies {
		keys = append(keys, name)
	}
	sort.Strings(keys)

	var paths []dependencyPath
	for _, name := range keys {
		child := node.Dependencies[name]
		childNames := appendCopy(names, name)
		childVersions := appendCopy(versions, child.Version)
		if name == "image-size" {
			paths = append(paths, dependencyPath{Names: childNames, Versions: childVersions})
			continue
		}
		paths = append(paths, findDependencyPaths(child, childNames, childVersions)...)
	}
	return paths
}

func appendCopy(values []string, value string) []string {
	result := make([]string, len(values), len(values)+1)
	copy(result, values)
	return append(result, value)
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
