# Openbook — auth and billing spine

Openbook is a **web** social app. Password auth works with no extra keys.
Stripe billing is optional: the free plan caps **lifetime posts at 100**;
Pro removes the cap. The plan panel lives on the Settings page.

## What's included

| Piece | Files | What it does |
|---|---|---|
| **Auth** | `convex/auth.ts` | Password sign-in. GitHub/Google providers are listed so an operator can set `AUTH_GITHUB_*` / `AUTH_GOOGLE_*`; they are not shown in the UI today. |
| **Stripe billing** | `convex/billing.ts`, `convex/lib/stripe.ts`, `convex/http.ts` | Checkout + portal + a signature-verified webhook → `subscriptions`. Return URLs must match `SITE_URL` or a local http host. |
| **Plan gating** | `convex/lib/plans.ts` | `effectivePlan` + `assertWithinLimit`. Free: 100 posts. Pro: unlimited. |
| **Billing UI** | `apps/web/src/components/BillingPanel.tsx` | Mounted on Settings. Without Stripe keys, Upgrade surfaces the setup error. |
| **Tests** | `convex/lib/stripe.test.ts`, `convex/billing.test.ts` | Signature verification, return-URL allowlist, webhook sync, plan gate. |
| **Live harness** | `scripts/dev-selfhost.sh`, `scripts/verify-live.mjs`, `scripts/go-live-check.sh` | Local OSS backend + over-the-wire social proof. |

## Prove it works in 2 minutes (no cloud login, no keys)

```bash
pnpm install
pnpm test
bash scripts/dev-selfhost.sh
node scripts/verify-live.mjs
docker rm -f openbook-convex
```

## Turn on billing (Stripe TEST mode)

```bash
stripe prices create --unit-amount 900 --currency usd -d "recurring[interval]=month" \
  -d "product_data[name]=Openbook Pro"
npx convex env set STRIPE_SECRET_KEY sk_test_…
npx convex env set STRIPE_WEBHOOK_SECRET whsec_…
npx convex env set STRIPE_PRICE_PRO price_…
npx convex env set SITE_URL http://localhost:5173
```

Then Settings → Upgrade to Pro.

## Make it a free app

Delete `convex/billing.ts`, `convex/lib/{stripe,plans}.ts`, `convex/lib/*.test.ts`,
`apps/web/src/components/BillingPanel.tsx`, the `subscriptions` table in
`convex/schema.ts`, the `/stripe/webhook` route in `convex/http.ts`, and the
plan gate in `convex/posts.ts`. Auth and the social graph remain.
