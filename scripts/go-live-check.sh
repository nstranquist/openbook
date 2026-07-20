#!/usr/bin/env bash
# Openbook go-live preflight — the executable form of the SaaS-kit runbook.
#
# Validates that the deployment env has what a user needs to sign up (and pay, if
# you enabled billing), does a LIVE Stripe check when keys are present, and exits
# non-zero if anything payment-critical is missing. Does NOT mutate anything and
# never prints secret values.
#
#   set -a; . ./.env.local; set +a   # (or export the deployment env)
#   bash scripts/go-live-check.sh
set -uo pipefail

fail=0; warn=0
row() { printf '  %-22s %s\n' "$1" "$2"; }
have() { [ -n "${!1:-}" ] && [ "${!1:-}" != "${2:-__none__}" ]; }

echo "Openbook go-live preflight"
echo
echo "▌ Frontend → backend"
if have VITE_CONVEX_URL; then row "VITE_CONVEX_URL" "✓ $VITE_CONVEX_URL"; else row "VITE_CONVEX_URL" "✗ MISSING (web can't reach Convex)"; fail=1; fi

echo
echo "▌ Auth (sign-in)"
if { have JWT_PRIVATE_KEY && have JWKS; } || have CONVEX_AUTH_PRIVATE_KEY; then
  row "Convex Auth keys" "✓ set"
else
  row "Convex Auth keys" "✗ run: pnpm auth:setup (or set JWT_PRIVATE_KEY + JWKS)"; fail=1
fi
oauth_ok=1
for v in AUTH_GITHUB_ID AUTH_GITHUB_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do have "$v" || oauth_ok=0; done
if [ "$oauth_ok" = 1 ]; then row "OAuth (GitHub+Google)" "✓ all 4 creds set"; else row "OAuth (GitHub+Google)" "⚠ optional — password sign-in works without it"; warn=1; fi

echo
echo "▌ Billing (only if you kept the SaaS-kit billing)"
sk="${STRIPE_SECRET_KEY:-}"
if [ -z "$sk" ]; then
  row "STRIPE_SECRET_KEY" "⊘ unset — billing disabled (delete BillingPanel/billing.ts for a free app)"; warn=1
else
  case "$sk" in
    sk_live_*) row "STRIPE_SECRET_KEY" "✓ LIVE mode";;
    sk_test_*) row "STRIPE_SECRET_KEY" "✓ test mode — switch to sk_live_ to charge real cards"; warn=1;;
    *) row "STRIPE_SECRET_KEY" "✗ not a Stripe secret key"; fail=1;;
  esac
  if have STRIPE_WEBHOOK_SECRET; then row "STRIPE_WEBHOOK_SECRET" "✓ set"; else row "STRIPE_WEBHOOK_SECRET" "✗ MISSING (register the webhook endpoint, then set it)"; fail=1; fi
  price="${STRIPE_PRICE_PRO:-}"
  if [ -z "$price" ]; then
    row "STRIPE_PRICE_PRO" "✗ MISSING"; fail=1
  else
    resp=$(curl -s -H "Authorization: Bearer $sk" "https://api.stripe.com/v1/prices/$price" 2>/dev/null)
    if printf '%s' "$resp" | grep -q '"active": *true' && printf '%s' "$resp" | grep -q '"type": *"recurring"'; then
      amount=$(printf '%s' "$resp" | grep -o '"unit_amount": *[0-9]*' | head -1 | grep -o '[0-9]*')
      row "STRIPE_PRICE_PRO" "✓ live: active recurring, \$$(awk "BEGIN{printf \"%.2f\", ${amount:-0}/100}")/period"
    else
      row "STRIPE_PRICE_PRO" "✗ Stripe rejected the price (not active/recurring)"; fail=1
    fi
  fi
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "RESULT: NOT READY — fix the ✗ rows above."
  exit 1
elif [ "$warn" -ne 0 ]; then
  echo "RESULT: READY (with warnings ⚠/⊘). Review them before launch."
else
  echo "RESULT: GO — every required var is set and Stripe is reachable."
fi
