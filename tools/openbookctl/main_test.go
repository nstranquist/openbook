package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunHelpAndUnknownCommand(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := run([]string{"help"}, &stdout, &stderr); code != 0 {
		t.Fatalf("help exit code = %d", code)
	}
	if !strings.Contains(stdout.String(), "readiness") {
		t.Fatalf("help output = %q", stdout.String())
	}
	stdout.Reset()
	if code := run([]string{"not-a-command"}, &stdout, &stderr); code != 1 {
		t.Fatalf("unknown exit code = %d", code)
	}
}
