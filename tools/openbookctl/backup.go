package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var requiredBackupTables = []string{
	"accountDeletionJobs",
	"albumItems",
	"albums",
	"authAccounts",
	"authRateLimits",
	"authRefreshTokens",
	"authSessions",
	"authVerificationCodes",
	"authVerifiers",
	"blocks",
	"clientErrorRateLimits",
	"clientErrors",
	"comments",
	"conversationMembers",
	"conversationTyping",
	"conversations",
	"deliveryJobs",
	"eventRsvps",
	"events",
	"externalIdentities",
	"friendships",
	"friendEdges",
	"groupMembers",
	"groups",
	"loadProbeSamples",
	"maintenanceCursors",
	"messages",
	"migrationJobs",
	"mutes",
	"notifications",
	"opsState",
	"pairLocks",
	"posts",
	"profiles",
	"pushSubscriptions",
	"rateLimits",
	"reactions",
	"reports",
	"savedPosts",
	"stories",
	"stripeWebhookEvents",
	"subscriptions",
	"uploadGrants",
	"uploads",
	"userStats",
	"users",
}

type backupReport struct {
	SchemaVersion     string   `json:"schema_version"`
	VerifiedAt        string   `json:"verified_at"`
	Outcome           string   `json:"outcome"`
	Path              string   `json:"path"`
	SHA256            string   `json:"sha256"`
	SizeBytes         int64    `json:"size_bytes"`
	UncompressedBytes uint64   `json:"uncompressed_bytes"`
	EntryCount        int      `json:"entry_count"`
	TableCount        int      `json:"table_count"`
	StorageFileCount  int      `json:"storage_file_count"`
	StorageIncluded   bool     `json:"storage_included"`
	MissingTables     []string `json:"missing_tables"`
}

func runBackup(args []string, stdout io.Writer) error {
	if len(args) == 0 || args[0] != "verify" {
		return &usageError{message: "use backup verify --file <snapshot.zip>"}
	}
	fs := flag.NewFlagSet("backup verify", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	file := fs.String("file", "", "Convex backup ZIP file")
	manifest := fs.String("manifest", "", "optional private receipt path")
	requireStorage := boolFlag(fs, "require-storage", true, "require file-storage metadata")
	maxUncompressedGiB := fs.Uint64("max-uncompressed-gib", 1024, "maximum expanded archive size")
	jsonMode := boolFlag(fs, "json", false, "emit JSON")
	if err := fs.Parse(args[1:]); err != nil {
		return &usageError{message: err.Error()}
	}
	if fs.NArg() != 0 || *file == "" {
		return &usageError{message: "backup verify requires --file and no positional arguments"}
	}
	report, err := verifyBackup(*file, *requireStorage, *maxUncompressedGiB<<30)
	if err != nil {
		return err
	}
	if *manifest != "" {
		if err := writePrivateJSON(*manifest, report); err != nil {
			return fmt.Errorf("write backup manifest: %w", err)
		}
	}
	if err := writeReport(stdout, report, *jsonMode); err != nil {
		return err
	}
	if report.Outcome == "fail" {
		return fmt.Errorf("backup verification failed")
	}
	return nil
}

func verifyBackup(rawPath string, requireStorage bool, maxUncompressed uint64) (backupReport, error) {
	absPath, err := filepath.Abs(rawPath)
	if err != nil {
		return backupReport{}, fmt.Errorf("resolve backup path: %w", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return backupReport{}, fmt.Errorf("stat backup: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return backupReport{}, fmt.Errorf("backup must be a non-empty regular file")
	}
	if strings.ToLower(filepath.Ext(absPath)) != ".zip" {
		return backupReport{}, fmt.Errorf("backup must use the .zip extension")
	}

	file, err := os.Open(absPath)
	if err != nil {
		return backupReport{}, fmt.Errorf("open backup: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		file.Close()
		return backupReport{}, fmt.Errorf("hash backup: %w", err)
	}
	if err := file.Close(); err != nil {
		return backupReport{}, fmt.Errorf("close backup: %w", err)
	}

	archive, err := zip.OpenReader(absPath)
	if err != nil {
		return backupReport{}, fmt.Errorf("open backup ZIP: %w", err)
	}
	defer archive.Close()
	if len(archive.File) == 0 || len(archive.File) > 200000 {
		return backupReport{}, fmt.Errorf("backup has an invalid entry count")
	}
	tables := map[string]bool{}
	storageIncluded := false
	storageFileCount := 0
	var uncompressed uint64
	for _, entry := range archive.File {
		clean := path.Clean(entry.Name)
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(entry.Name, "/") || strings.Contains(entry.Name, "\\") {
			return backupReport{}, fmt.Errorf("backup contains unsafe entry %q", entry.Name)
		}
		if ^uint64(0)-uncompressed < entry.UncompressedSize64 {
			return backupReport{}, fmt.Errorf("backup expanded size overflow")
		}
		uncompressed += entry.UncompressedSize64
		if maxUncompressed > 0 && uncompressed > maxUncompressed {
			return backupReport{}, fmt.Errorf("backup expands beyond the configured limit")
		}
		parts := strings.Split(clean, "/")
		if len(parts) == 2 && parts[1] == "documents.jsonl" {
			if parts[0] == "_storage" {
				storageIncluded = true
			} else if !strings.HasPrefix(parts[0], "_") {
				tables[parts[0]] = true
			}
		}
		if len(parts) == 2 && parts[0] == "_storage" && parts[1] != "documents.jsonl" && !entry.FileInfo().IsDir() {
			storageFileCount++
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return backupReport{}, fmt.Errorf("open backup entry %q: %w", entry.Name, err)
		}
		_, copyErr := io.Copy(io.Discard, reader)
		closeErr := reader.Close()
		if copyErr != nil {
			return backupReport{}, fmt.Errorf("verify backup entry %q: %w", entry.Name, copyErr)
		}
		if closeErr != nil {
			return backupReport{}, fmt.Errorf("close backup entry %q: %w", entry.Name, closeErr)
		}
	}

	missing := []string{}
	for _, table := range requiredBackupTables {
		if !tables[table] {
			missing = append(missing, table)
		}
	}
	if requireStorage && !storageIncluded {
		missing = append(missing, "_storage")
	}
	sort.Strings(missing)
	outcome := "pass"
	if len(missing) > 0 {
		outcome = "fail"
	}
	return backupReport{
		SchemaVersion:     reportSchemaVersion,
		VerifiedAt:        time.Now().UTC().Format(time.RFC3339),
		Outcome:           outcome,
		Path:              absPath,
		SHA256:            hex.EncodeToString(hash.Sum(nil)),
		SizeBytes:         info.Size(),
		UncompressedBytes: uncompressed,
		EntryCount:        len(archive.File),
		TableCount:        len(tables),
		StorageFileCount:  storageFileCount,
		StorageIncluded:   storageIncluded,
		MissingTables:     missing,
	}, nil
}

func writePrivateJSON(rawPath string, value any) error {
	absPath, err := filepath.Abs(rawPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absPath), ".openbookctl-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(body); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, absPath)
}
