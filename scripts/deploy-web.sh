#!/usr/bin/env bash
# Operator-gated publication of the already-reviewed web build to Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${OPENBOOK_DEPLOY:-}" != "I_UNDERSTAND" ]; then
  echo "Refusing a Cloudflare deployment. Set OPENBOOK_DEPLOY=I_UNDERSTAND." >&2
  exit 2
fi
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Refusing a deploy from a dirty checkout." >&2
  exit 2
fi
HEAD_SHA="$(git rev-parse HEAD)"
if [ "${OPENBOOK_RELEASE:-}" != "$HEAD_SHA" ]; then
  echo "Set OPENBOOK_RELEASE to the exact deployed Git commit: $HEAD_SHA" >&2
  exit 2
fi
if [ -z "${CLOUDFLARE_PAGES_PROJECT:-}" ]; then
  echo "Set CLOUDFLARE_PAGES_PROJECT to the existing Direct Upload project." >&2
  exit 2
fi
if [ "${VITE_OPENBOOK_ENV:-}" != "production" ]; then
  echo "Set VITE_OPENBOOK_ENV=production." >&2
  exit 2
fi

pnpm verify:publication
pnpm production:readiness
pnpm --filter web build
env GO111MODULE=off go run ./tools/openbookctl headers \
  --file apps/web/dist/_headers \
  --clerk-origin "$CLERK_JWT_ISSUER_DOMAIN" \
  --convex-origin "$VITE_CONVEX_URL" \
  --convex-site-origin "$CONVEX_SITE_URL"
pnpm exec wrangler pages deploy apps/web/dist \
  --project-name "$CLOUDFLARE_PAGES_PROJECT" \
  --branch "${CLOUDFLARE_PAGES_BRANCH:-main}" \
  --commit-hash "$OPENBOOK_RELEASE" \
  --commit-message "openbook $OPENBOOK_RELEASE" \
  --commit-dirty=false
pnpm production:probe
