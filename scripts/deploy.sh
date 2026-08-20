#!/usr/bin/env bash
# Operator-gated hosted deploy (KEP-003). Does not create a public userbase
# by itself. Refuses unless OPENBOOK_DEPLOY=I_UNDERSTAND.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${OPENBOOK_DEPLOY:-}" != "I_UNDERSTAND" ]; then
  echo "Refusing hosted deploy."
  echo "1. Fill Convex env (SITE_URL, auth keys, optional Stripe/Resend/VAPID)."
  echo "2. bash scripts/go-live-check.sh"
  echo "3. OPENBOOK_DEPLOY=I_UNDERSTAND bash scripts/deploy.sh"
  exit 2
fi
bash scripts/go-live-check.sh
npx convex deploy
echo "Convex functions deployed. Point VITE_CONVEX_URL at the deployment and ship apps/web/dist."
