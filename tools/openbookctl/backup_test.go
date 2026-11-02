package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func TestRequiredBackupTablesCoverApplicationSchema(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "convex", "schema.ts"))
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`(?m)^  ([A-Za-z][A-Za-z0-9]*): defineTable`)
	required := make(map[string]bool, len(requiredBackupTables))
	for _, table := range requiredBackupTables {
		required[table] = true
	}
	for _, match := range pattern.FindAllSubmatch(body, -1) {
		table := string(match[1])
		if !required[table] {
			t.Errorf("schema table %q is not required by backup verification", table)
		}
	}
}

func TestVerifyBackupChecksTablesStorageAndCRC(t *testing.T) {
	file := filepath.Join(t.TempDir(), "snapshot.zip")
	writeTestBackup(t, file, false)
	report, err := verifyBackup(file, true, 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "pass" || len(report.MissingTables) != 0 || !report.StorageIncluded || report.SHA256 == "" {
		t.Fatalf("report = %#v", report)
	}
}

func TestVerifyBackupFailsMissingTable(t *testing.T) {
	file := filepath.Join(t.TempDir(), "snapshot.zip")
	writeTestBackup(t, file, true)
	report, err := verifyBackup(file, true, 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "fail" || len(report.MissingTables) == 0 {
		t.Fatalf("report = %#v", report)
	}
}

func writeTestBackup(t *testing.T, file string, omitLast bool) {
	t.Helper()
	out, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(out)
	tables := requiredBackupTables
	if omitLast {
		tables = tables[:len(tables)-1]
	}
	for _, table := range tables {
		writer, err := archive.Create(table + "/documents.jsonl")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte("\n")); err != nil {
			t.Fatal(err)
		}
	}
	storage, err := archive.Create("_storage/documents.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}
