#!/usr/bin/env bash
# Export a complete Convex snapshot and verify its structure and checksum.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-}"
TARGET="${OPENBOOK_BACKUP_TARGET:-production}"
if [[ "$OUT" != /* ]] || [[ "$OUT" != *.zip ]]; then
  echo "Use an absolute, unused .zip path." >&2
  exit 2
fi
if [ -e "$OUT" ]; then
  echo "Refusing to overwrite $OUT" >&2
  exit 2
fi
if [ ! -d "$(dirname "$OUT")" ]; then
  echo "Create the parent directory before this command." >&2
  exit 2
fi

case "$TARGET" in
  production)
    if [ "${OPENBOOK_BACKUP_PROD:-}" != "I_UNDERSTAND" ]; then
      echo "Set OPENBOOK_BACKUP_PROD=I_UNDERSTAND for a production export." >&2
      exit 2
    fi
    DEPLOYMENT_ARGS=(--prod)
    ;;
  development)
    DEPLOYMENT_ARGS=(--deployment dev)
    ;;
  local)
    DEPLOYMENT_ARGS=()
    if [ -z "${CONVEX_SELF_HOSTED_URL:-}" ]; then
      if [ -n "${CONVEX_URL:-}" ]; then
        CONVEX_SELF_HOSTED_URL="$CONVEX_URL"
      elif [ -f .env.local ]; then
        CONVEX_SELF_HOSTED_URL="$(sed -n 's/^CONVEX_URL=//p' .env.local | tail -1)"
      fi
    fi
    case "${CONVEX_SELF_HOSTED_URL:-}" in
      http://127.0.0.1:*|http://localhost:*) ;;
      *)
        echo "Local backup requires a loopback CONVEX_SELF_HOSTED_URL." >&2
        exit 2
        ;;
    esac
    if [ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]; then
      CONTAINER="${CONVEX_CONTAINER:-openbook-convex}"
      if ! docker ps --format '{{.Names}}' | rg -Fxq "$CONTAINER"; then
        echo "Local backup requires the running container $CONTAINER." >&2
        exit 2
      fi
      CONVEX_SELF_HOSTED_ADMIN_KEY="$(docker exec "$CONTAINER" ./generate_admin_key.sh 2>/dev/null | tail -1)"
    fi
    if [ -z "$CONVEX_SELF_HOSTED_ADMIN_KEY" ]; then
      echo "Could not obtain the local Convex admin key." >&2
      exit 2
    fi
    export CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
    ;;
  *)
    echo "OPENBOOK_BACKUP_TARGET must be production, development, or local." >&2
    exit 2
    ;;
esac

npx convex export --include-file-storage "${DEPLOYMENT_ARGS[@]}" --path "$OUT"
env GO111MODULE=off go run ./tools/openbookctl backup verify \
  --file "$OUT" \
  --manifest "$OUT.manifest.json"
echo "Backup and private manifest are ready."
