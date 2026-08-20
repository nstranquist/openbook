# Backend — Convex Realtime

This `convex/` directory is the **web** backend. Openbook ships one client:
`apps/web`. There is no mobile or desktop app in this repository.

- `schema.ts` — auth tables plus profiles, posts, comments, reactions,
  friendships, notifications, conversations, messages, and billing.
- `lib/social.ts` — pair keys, post visibility, enrichment, notification
  fan-out. Comments and reactions call `requireVisiblePost` / `loadVisiblePost`.
- `auth.ts` / `auth.config.ts` / `http.ts` — Convex Auth (password; optional
  GitHub/Google when those env vars are set) and the Stripe webhook.
- `_generated/` is **committed** so a clean checkout can typecheck and test
  before a Convex deployment exists. Regenerate with `npx convex codegen`
  or `npx convex dev --once`.

Run `npx convex dev` from the repo root against Convex cloud, or
`pnpm selfhost` for the local OSS backend.
