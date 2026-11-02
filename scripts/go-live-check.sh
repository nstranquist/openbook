#!/usr/bin/env bash
# Compatibility wrapper. The typed production check is implemented in Go.
set -euo pipefail
cd "$(dirname "$0")/.."
exec env GO111MODULE=off go run ./tools/openbookctl readiness --online "$@"
