#!/usr/bin/env bash
# Operator-gated Convex deploy and immutable web build.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${OPENBOOK_DEPLOY:-}" != "I_UNDERSTAND" ]; then
  echo "Refusing hosted deploy."
  echo "1. Export the production environment contract."
  echo "2. bash scripts/go-live-check.sh"
  echo "3. OPENBOOK_DEPLOY=I_UNDERSTAND bash scripts/deploy.sh"
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
export VITE_OPENBOOK_RELEASE="$OPENBOOK_RELEASE"
export VITE_OPENBOOK_ENV=production
export VITE_OPENBOOK_AUTH_MODE=clerk
export VITE_CONVEX_SITE_URL="$CONVEX_SITE_URL"
export VITE_OPENBOOK_ERROR_REPORT_URL="${CONVEX_SITE_URL%/}/client-errors"
bash scripts/go-live-check.sh
npx convex env set --prod OPENBOOK_AUTH_MODE clerk
npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN "$CLERK_JWT_ISSUER_DOMAIN"
npx convex env set --prod CLERK_SECRET_KEY "$CLERK_SECRET_KEY"
npx convex deploy \
  --cmd 'pnpm --filter web build' \
  --cmd-url-env-var-name VITE_CONVEX_URL \
  --message "openbook ${OPENBOOK_RELEASE}"
npx convex env set --prod OPENBOOK_ENV production
npx convex env set --prod OPENBOOK_RELEASE "$OPENBOOK_RELEASE"
MIGRATION_STATUS="$(npx convex run --prod migrations:userStatsStatus '{}')"
MIGRATION_STATE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$MIGRATION_STATUS")"
if [ "$MIGRATION_STATE" != "complete" ]; then
  if [ "${OPENBOOK_MIGRATION_TRAFFIC_DRAINED:-}" != "I_UNDERSTAND" ]; then
    echo "The required counter and storage migration needs a traffic-drained deployment." >&2
    echo "Drain writes, then set OPENBOOK_MIGRATION_TRAFFIC_DRAINED=I_UNDERSTAND." >&2
    exit 2
  fi
  npx convex run --prod migrations:startUserStats '{}'
fi
MIGRATION_WAIT_SECONDS="${OPENBOOK_MIGRATION_WAIT_SECONDS:-900}"
if ! [[ "$MIGRATION_WAIT_SECONDS" =~ ^[0-9]+$ ]] || [ "$MIGRATION_WAIT_SECONDS" -lt 1 ]; then
  echo "OPENBOOK_MIGRATION_WAIT_SECONDS must be a positive integer." >&2
  exit 2
fi
MIGRATION_DEADLINE=$((SECONDS + MIGRATION_WAIT_SECONDS))
while :; do
  MIGRATION_STATUS="$(npx convex run --prod migrations:userStatsStatus '{}')"
  MIGRATION_STATE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$MIGRATION_STATUS")"
  if [ "$MIGRATION_STATE" = "complete" ]; then
    break
  fi
  if [ "$SECONDS" -ge "$MIGRATION_DEADLINE" ]; then
    echo "Required production migration did not complete before the deadline." >&2
    exit 1
  fi
  sleep 2
done
npx convex run --prod health:heartbeat '{}'
npx convex run --prod delivery:dispatch '{}'
npx convex run --prod gc:unusedUploads '{}'
npx convex run --prod gc:orphanedStorage '{}'
npx convex run --prod gc:expiredStories '{}'
npx convex run --prod maintenance:pruneEphemeral '{}'
curl --fail --show-error --silent "${CONVEX_SITE_URL%/}/ready" >/dev/null
echo "Convex functions are deployed and apps/web/dist is bound to this deployment."
echo "Run scripts/deploy-web.sh to publish the reviewed assets to Cloudflare Pages."
