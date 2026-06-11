#!/usr/bin/env bash
# Bootstrap a fully-local Openbook backend with NO Convex cloud login.
#
# Runs the open-source Convex backend in Docker, generates the admin key + RS256
# Convex Auth keys, and pushes the schema/functions. Idempotent. This is the local
# stand-in for `npx convex deploy` — it proves the schema + every function deploy
# and run against a REAL Convex backend, which `tsc`/vitest cannot.
#
#   bash scripts/dev-selfhost.sh
#   node scripts/verify-live.mjs        # then prove the live round-trip
#   (cd apps/web && VITE_CONVEX_URL=http://127.0.0.1:3210 pnpm dev)   # or run the app
#
# Stripe/OAuth stay operator-gated — set their env on the deployment to exercise
# them live (see .env.example / SAAS-KIT.md). Ports are overridable so several
# self-hosted Convex backends can run side by side.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${CONVEX_CONTAINER:-openbook-convex}"
PORT="${CONVEX_PORT:-3210}"
SITE_PORT="${CONVEX_SITE_PORT:-3211}"
URL="http://127.0.0.1:${PORT}"
SITE="http://127.0.0.1:${SITE_PORT}"
WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:5173}"
# The convex-backend image always serves the site (Convex Auth JWKS) on internal
# :3211. Convex Auth self-fetches its JWKS from CONVEX_SITE_ORIGIN *inside the
# container*, so it MUST be the internal :3211 — pointing it at a remapped host
# port makes JWKS discovery fail and every authenticated mutation 500s.
CONTAINER_SITE_ORIGIN="http://127.0.0.1:3211"

echo "▌ 1/5  Convex backend container ($CONTAINER)"
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -p "${PORT}:3210" -p "${SITE_PORT}:3211" \
    -e INSTANCE_NAME=openbook \
    -e CONVEX_CLOUD_ORIGIN="$URL" -e CONVEX_SITE_ORIGIN="$CONTAINER_SITE_ORIGIN" \
    ghcr.io/get-convex/convex-backend:latest >/dev/null
fi
for _ in $(seq 1 60); do curl -sf -o /dev/null "$URL/version" && break || sleep 1; done
curl -sf -o /dev/null "$URL/version" || { echo "   backend did not come up at $URL"; exit 1; }
echo "   up at $URL"

echo "▌ 2/5  Admin key"
ADMIN_KEY=$(docker exec "$CONTAINER" ./generate_admin_key.sh 2>/dev/null | tail -1)
export CONVEX_SELF_HOSTED_URL="$URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"

echo "▌ 3/5  Convex Auth JWT keys (RS256)"
node -e '
const fs=require("node:fs"),{generateKeyPairSync}=require("node:crypto");
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
fs.writeFileSync("/tmp/openbook-jwt.pem",privateKey.export({type:"pkcs8",format:"pem"}).toString());
fs.writeFileSync("/tmp/openbook-jwks.json",JSON.stringify({keys:[{use:"sig",alg:"RS256",...publicKey.export({format:"jwk"})}]}));
'
PEM_ONELINE=$(node -e 'console.log(require("node:fs").readFileSync("/tmp/openbook-jwt.pem","utf8").trimEnd().replace(/\n/g," "))')
npx convex env set "JWT_PRIVATE_KEY=$PEM_ONELINE" >/dev/null
npx convex env set "JWKS=$(cat /tmp/openbook-jwks.json)" >/dev/null
npx convex env set SITE_URL "$WEB_ORIGIN" >/dev/null
rm -f /tmp/openbook-jwt.pem /tmp/openbook-jwks.json

echo "▌ 4/5  Push schema + functions (codegen)"
npx convex dev --once >/dev/null
echo "   functions ready"

echo "▌ 5/5  Done"
cat <<EOF

  Local Convex (no cloud login):  $URL
  HTTP actions from the host (Stripe webhook etc.):  $SITE
    e.g. forward Stripe locally:  stripe listen --forward-to $SITE/stripe/webhook
  Prove the live round-trip:
    CONVEX_SELF_HOSTED_URL=$URL node scripts/verify-live.mjs
  Run the app:
    (cd apps/web && VITE_CONVEX_URL=$URL pnpm dev)
  Teardown:
    docker rm -f $CONTAINER
EOF
