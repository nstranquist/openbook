#!/usr/bin/env bash
# Restore a verified snapshot into a new disposable local Convex backend.
set -euo pipefail
cd "$(dirname "$0")/.."

SNAPSHOT="${1:-}"
if [ "${OPENBOOK_RESTORE_DRILL:-}" != "I_UNDERSTAND" ]; then
  echo "Set OPENBOOK_RESTORE_DRILL=I_UNDERSTAND for a disposable restore drill." >&2
  exit 2
fi
if [[ "$SNAPSHOT" != /* ]] || [[ "$SNAPSHOT" != *.zip ]] || [ ! -f "$SNAPSHOT" ]; then
  echo "Pass an absolute snapshot ZIP path." >&2
  exit 2
fi

CONTAINER="${CONVEX_RESTORE_CONTAINER:-openbook-convex-restore-drill}"
PORT="${CONVEX_RESTORE_PORT:-3320}"
SITE_PORT="${CONVEX_RESTORE_SITE_PORT:-3321}"
URL="http://127.0.0.1:${PORT}"
SITE_URL="http://127.0.0.1:${SITE_PORT}"
IMAGE="${CONVEX_IMAGE:-ghcr.io/convex/convex-backend@sha256:1f2044e3eac463ac78973b136c0baf72d4ada602611d853d6f99f280e29e0a98}"
TASK_DIR="$(mktemp -d /tmp/openbook-restore-drill.XXXXXX)"
HAD_LOCAL_ENV=0

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "Refusing to replace existing container $CONTAINER." >&2
  rmdir "$TASK_DIR"
  exit 2
fi
if [ -f .env.local ]; then
  cp -p .env.local "$TASK_DIR/env.local"
  HAD_LOCAL_ENV=1
fi

cleanup_restore_drill() {
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
  docker container rm "$CONTAINER" >/dev/null 2>&1 || true
  if [ "$HAD_LOCAL_ENV" -eq 1 ] && [ -f "$TASK_DIR/env.local" ]; then
    cp -p "$TASK_DIR/env.local" .env.local
    unlink "$TASK_DIR/env.local"
  elif [ "$HAD_LOCAL_ENV" -eq 0 ] && [ -f .env.local ]; then
    unlink .env.local
  fi
  rmdir "$TASK_DIR" >/dev/null 2>&1 || true
}
trap cleanup_restore_drill EXIT

env GO111MODULE=off go run ./tools/openbookctl backup verify --file "$SNAPSHOT"
docker run -d --name "$CONTAINER" -p "${PORT}:3210" -p "${SITE_PORT}:3211" \
  -e INSTANCE_NAME=openbook-restore-drill \
  -e CONVEX_CLOUD_ORIGIN="$URL" -e CONVEX_SITE_ORIGIN=http://127.0.0.1:3211 \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$URL/version"; then break; fi
  sleep 1
done
curl -sf -o /dev/null "$URL/version"
ADMIN_KEY="$(docker exec "$CONTAINER" ./generate_admin_key.sh 2>/dev/null | tail -1)"
export CONVEX_SELF_HOSTED_URL="$URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"
npx convex env set OPENBOOK_AUTH_MODE convex-auth >/dev/null
npx convex dev --once
npx convex import "$SNAPSHOT" --replace-all -y
npx convex run migrations:startUserStats '{}'
for _ in $(seq 1 60); do
  MIGRATION_STATUS="$(npx convex run migrations:userStatsStatus '{}')"
  printf '%s' "$MIGRATION_STATUS" | grep -Fq '"status": "complete"' && break
  sleep 1
done
printf '%s' "$MIGRATION_STATUS" | grep -Fq '"status": "complete"' || {
  echo "Required migration did not complete in the restored deployment." >&2
  exit 1
}
npx convex run health:heartbeat '{}'
npx convex run delivery:dispatch '{}'
npx convex run gc:unusedUploads '{}'
npx convex run gc:orphanedStorage '{}'
npx convex run gc:expiredStories '{}'
npx convex run maintenance:pruneEphemeral '{}'
npx convex run clientTelemetry:summary '{"since":0}'
curl -fsS "$SITE_URL/ready"
echo
echo "Restore drill passed. The disposable backend will now be removed."
