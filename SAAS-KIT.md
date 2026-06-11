# Openbook — SaaS kit

This suite ships the **Convex SaaS kit**: everything a billable, authed product
needs, wired and live-verifiable out of the box. It's the proven plumbing extracted
from nvault-cloud, generalized. Keep what you need; delete the rest for a free app.

## What's included

| Piece | Files | What it does |
|---|---|---|
| **Auth + OAuth** | `convex/auth.ts` | Password + GitHub + Google (OAuth env-gated; password works alone) |
| **Stripe billing** | `convex/billing.ts`, `convex/lib/stripe.ts`, `convex/http.ts` | Checkout + portal + a signature-verified webhook → `subscriptions` table. Dependency-free (Web Crypto, no `stripe` SDK). |
| **Plan gating** | `convex/lib/plans.ts` | `effectivePlan` (subscription-aware) + `assertWithinLimit`. Demo: free tier caps `notes` at 50, Pro is unlimited. |
| **Billing UI** | `apps/web/src/components/BillingPanel.tsx` | Plan + usage + Upgrade-to-Pro / Manage-billing buttons. Ships ready — add `<BillingPanel />` to `apps/web/src/App.tsx` (kept out of the shared shell so the demo app stays identical across lanes). |
| **Tests** | `convex/lib/stripe.test.ts`, `convex/billing.test.ts` | `pnpm test` — signature verification + webhook sync + the plan gate. |
| **Live harness** | `scripts/dev-selfhost.sh`, `scripts/verify-live.mjs`, `scripts/go-live-check.sh` | Run the whole backend locally (no cloud login) and prove it end to end. |

## Prove it works in 2 minutes (no cloud login, no keys)

```bash
pnpm install
pnpm test                      # convex-test: signature + billing sync + gate
bash scripts/dev-selfhost.sh   # OSS Convex backend in Docker + push functions
node scripts/verify-live.mjs   # signup → synced note → free plan (Stripe step SKIPs w/o keys)
docker rm -f openbook-convex
```

## Turn on billing (Stripe TEST mode)

```bash
# 1) Create the Pro price once (test mode); save the price_…
stripe prices create --unit-amount 900 --currency usd -d "recurring[interval]=month" \
  -d "product_data[name]=Openbook Pro"
# 2) Set keys on the deployment (self-hosted or cloud):
npx convex env set STRIPE_SECRET_KEY sk_test_…
npx convex env set STRIPE_WEBHOOK_SECRET whsec_…     # from `stripe listen --forward-to <site>/stripe/webhook`
npx convex env set STRIPE_PRICE_PRO price_…
# 3) verify-live now exercises a real Checkout; the BillingPanel "Upgrade" works.
node scripts/verify-live.mjs
```

## Go live (the operator-gated last mile)

```bash
npx convex deploy                  # prod deployment
pnpm auth:setup                    # generate the Convex Auth signing key (or set JWT_PRIVATE_KEY + JWKS)
npx convex env set ...             # OAuth (AUTH_GITHUB_*/AUTH_GOOGLE_*), Stripe (sk_live_…), email
bash scripts/go-live-check.sh      # preflight: every payment-critical var set + Stripe reachable?
pnpm --filter web build            # static web bundle → any CDN; point VITE_CONVEX_URL at the deployment
```

`go-live-check.sh` exits non-zero until a stranger can sign up (and pay, if you kept billing).

## Make it a free app

Delete `convex/billing.ts`, `convex/lib/{stripe,plans}.ts`, `convex/lib/*.test.ts`,
`apps/web/src/components/BillingPanel.tsx`, the `subscriptions` table in
`convex/schema.ts`, the `/stripe/webhook` route in `convex/http.ts`, and the plan
gate in `convex/notes.ts`. Auth + sync remain.
