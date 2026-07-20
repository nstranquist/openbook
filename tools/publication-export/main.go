// Command publication-export copies Openbook's reviewed tracked and untracked
// source files into a clean directory without carrying local Git history or
// ignored machine state.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type receipt struct {
	SchemaVersion int    `json:"schema_version"`
	SourceRoot    string `json:"source_root"`
	OutputRoot    string `json:"output_root"`
	FileCount     int    `json:"file_count"`
	Digest        string `json:"sha256"`
}

func main() {
	out := flag.String("out", "", "empty destination directory for the publication tree")
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if err := flag.CommandLine.Parse(args); err != nil {
		os.Exit(2)
	}
	if strings.TrimSpace(*out) == "" {
		fmt.Fprintln(os.Stderr, "publication-export: --out is required")
		os.Exit(2)
	}

	root, err := gitRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "publication-export:", err)
		os.Exit(1)
	}
	result, err := exportTree(root, *out)
	if err != nil {
		fmt.Fprintln(os.Stderr, "publication-export:", err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "publication-export: encode receipt:", err)
		os.Exit(1)
	}
}

func gitRoot() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	raw, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("resolve repository root: %w", err)
	}
	return filepath.Abs(strings.TrimSpace(string(raw)))
}

func exportTree(root, out string) (receipt, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return receipt{}, fmt.Errorf("resolve source root: %w", err)
	}
	out, err = filepath.Abs(out)
	if err != nil {
		return receipt{}, fmt.Errorf("resolve output root: %w", err)
	}
	if within(root, out) {
		return receipt{}, errors.New("output must be outside the source repository")
	}
	if err := prepareOutput(out); err != nil {
		return receipt{}, err
	}

	files, err := publicationFiles(root)
	if err != nil {
		return receipt{}, err
	}
	h := sha256.New()
	for _, rel := range files {
		if !safeRelative(rel) {
			return receipt{}, fmt.Errorf("unsafe Git path %q", rel)
		}
		if err := copyPath(root, out, rel, h); err != nil {
			return receipt{}, err
		}
	}
	return receipt{
		SchemaVersion: 1,
		SourceRoot:    root,
		OutputRoot:    out,
		FileCount:     len(files),
		Digest:        hex.EncodeToString(h.Sum(nil)),
	}, nil
}

func within(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func prepareOutput(out string) error {
	entries, err := os.ReadDir(out)
	switch {
	case err == nil && len(entries) != 0:
		return fmt.Errorf("output directory is not empty: %s", out)
	case err == nil:
		return nil
	case os.IsNotExist(err):
		return os.MkdirAll(out, 0o755)
	default:
		return fmt.Errorf("inspect output directory: %w", err)
	}
}

func publicationFiles(root string) ([]string, error) {
	cmd := exec.Command("git", "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	cmd.Dir = root
	raw, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("list publication files: %w", err)
	}
	parts := strings.Split(string(raw), "\x00")
	files := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			files = append(files, part)
		}
	}
	sort.Strings(files)
	return files, nil
}

func safeRelative(path string) bool {
	clean := filepath.Clean(path)
	return path != "" && path == clean && !filepath.IsAbs(path) &&
		clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func copyPath(root, out, rel string, digest io.Writer) error {
	src := filepath.Join(root, rel)
	dst := filepath.Join(out, rel)
	info, err := os.Lstat(src)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", rel, err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("create parent for %s: %w", rel, err)
	}
	if _, err := io.WriteString(digest, rel+"\x00"); err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(src)
		if err != nil {
			return fmt.Errorf("read symlink %s: %w", rel, err)
		}
		if _, err := io.WriteString(digest, "symlink\x00"+target+"\x00"); err != nil {
			return err
		}
		if err := os.Symlink(target, dst); err != nil {
			return fmt.Errorf("copy symlink %s: %w", rel, err)
		}
		return nil
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("unsupported non-regular path %s", rel)
	}

	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open %s: %w", rel, err)
	}
	defer in.Close()
	mode := info.Mode().Perm()
	if mode&0o111 != 0 {
		mode = 0o755
	} else {
		mode = 0o644
	}
	outFile, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return fmt.Errorf("create %s: %w", rel, err)
	}
	_, copyErr := io.Copy(io.MultiWriter(outFile, digest), in)
	closeErr := outFile.Close()
	if copyErr != nil {
		return fmt.Errorf("copy %s: %w", rel, copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close %s: %w", rel, closeErr)
	}
	if _, err := io.WriteString(digest, "\x00"); err != nil {
		return err
	}
	return nil
}
