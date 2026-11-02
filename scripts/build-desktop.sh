#!/usr/bin/env bash
# Build an unsigned production Tauri application with exact provider origins.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Refusing a production desktop build from a dirty checkout." >&2
  exit 2
fi
HEAD_SHA="$(git rev-parse HEAD)"
if [ "${OPENBOOK_RELEASE:-}" != "$HEAD_SHA" ]; then
  echo "Set OPENBOOK_RELEASE to the exact Git commit: $HEAD_SHA" >&2
  exit 2
fi
if [ "${VITE_OPENBOOK_ENV:-}" != "production" ]; then
  echo "Set VITE_OPENBOOK_ENV=production." >&2
  exit 2
fi
if [ "${VITE_OPENBOOK_AUTH_MODE:-}" != "clerk" ]; then
  echo "Set VITE_OPENBOOK_AUTH_MODE=clerk." >&2
  exit 2
fi

pnpm verify:publication
pnpm production:readiness
pnpm --filter web build

CONFIG_FILE="apps/desktop/src-tauri/target/openbook-production-config.json"
env GO111MODULE=off go run ./tools/openbookctl desktop-config \
  --file "$CONFIG_FILE" \
  --clerk-origin "$CLERK_JWT_ISSUER_DOMAIN" \
  --convex-origin "$VITE_CONVEX_URL" \
  --convex-site-origin "$CONVEX_SITE_URL"

(
  cd apps/desktop
  npm ci
  npm audit
  npm exec tauri -- build --ci --no-bundle \
    --config src-tauri/target/openbook-production-config.json
)

echo "Unsigned production application built. Signing and installer publication remain operator-gated."
