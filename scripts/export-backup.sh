#!/usr/bin/env bash
# Operator backup for KEP-003. Does not run in CI. Never commits the output.
#
# Cloud: `npx convex export` when the CLI and deployment allow it.
# Self-hosted: copy the Docker volume named in scripts/dev-selfhost.sh.
set -euo pipefail
OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "usage: bash scripts/export-backup.sh /absolute/empty/dir" >&2
  exit 2
fi
mkdir -p "$OUT"
if npx --yes convex export --help >/dev/null 2>&1; then
  npx convex export --path "$OUT"
  echo "Wrote Convex export under $OUT"
  exit 0
fi
echo "convex export is not available in this CLI. For self-hosted Openbook, snapshot the Docker volume instead of inventing a dump format." >&2
exit 1
