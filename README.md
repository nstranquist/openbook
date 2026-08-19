# Openbook

A full-featured **realtime social network** on a single **Convex Realtime** backend —
profiles, friend graph, audience-scoped feed, six-reaction posts, comments,
notifications, and Messenger-style DMs, all live-synced through reactive
queries (no sockets, no polling). Scaffolded by `ndev stack scaffold`
(lane: `convex-realtime`), then grown into the real social domain.

## Showcase

<img src="assets/brand/openbook.svg" width="96" height="96" alt="Openbook application icon">

![Openbook realtime feed with a locally created post](portfolio/assets/realtime-feed.png)

This capture comes from the fully local self-hosted Convex stack after a real
signup and post. It is the reviewed evidence declared in
`portfolio/manifest.yaml`.

## Features

- **Identity** — Convex Auth (email+password), auto-provisioned profile with
  deterministic-hue avatar/cover (zero file storage), editable bio/work/location.
- **Friend graph** — request → accept lifecycle (decline / cancel / unfriend),
  cross-request auto-accept, and *People You May Know* ranked by mutual friends.
- **Feed** — paginated, newest-first, server-side visibility: `friends`-audience
  posts reach only the author's friends; `public` posts reach everyone.
- **Reactions** — the classic six (👍❤️😆😮😢😡), one per user per post,
  hover picker, denormalized tallies kept exact in the same transaction.
- **Comments** — inline threads with exact counts and owner/author delete rights.
- **Notifications** — bell with unread badge for friend requests, accepts,
  reactions, and comments; mark-read / mark-all-read.
- **Messages** — per-pair conversations, realtime delivery, unread accounting,
  read receipts, conversation previews.
- **People search** — full-text search index over display names, live from the nav bar.
- **SaaS spine** (from the scaffold) — Stripe-mirrored subscriptions; the free
  tier caps lifetime posts at 100, Pro lifts it (`convex/lib/plans.ts`).

## Usage

| Surface | What you do |
|---|---|
| Local stack | `pnpm install` then `pnpm selfhost` and `pnpm dev` (see Quick start) |
| Cloud | `npx convex dev --once && pnpm auth:setup && pnpm dev` |
| Tests | `make test` or `pnpm test` (28 unit tests) |
| Live check | `node scripts/verify-live.mjs` against a running Convex URL |
| Publish gate | `make publish-ready` |

Accounts, posts, and screenshots in this tree are synthetic. Do not commit live Stripe keys or real user data.

```
openbook/
├── convex/                 # the backend: schema + social functions + tests
│   ├── schema.ts           # profiles · posts · comments · reactions · friendships
│   │                       #   · notifications · conversations · messages · billing
│   ├── lib/social.ts       # pairKey · visibility rule · enrichment · notify fan-out
│   └── social.test.ts      # convex-test suite for every social rule
├── packages/shared/        # zod inputs · reaction registry · auth hooks · api re-export
└── apps/web/               # Vite + React 19 + react-router social UI
    └── src/ui/openbook.css # social shell (ob-*) on the garrid OKLCH token spine
```

## Quick start (fully local, no Convex account)

```bash
pnpm install
CONVEX_PORT=3310 CONVEX_SITE_PORT=3311 pnpm selfhost   # Docker OSS Convex + keys + push
(cd apps/web && VITE_CONVEX_URL=http://127.0.0.1:3310 pnpm dev)
```

Or against Convex cloud: `npx convex dev --once && pnpm auth:setup && pnpm dev`.

## Verification (all green as of 2026-07-13)

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | 2/2 packages clean |
| Unit (simulated backend) | `pnpm test` / `make test` | 28/28 (social rules + billing gate + stripe + suggestion pending exclusion) |
| Live E2E (real backend) | `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3310 node scripts/verify-live.mjs` | 19/19 — 3 users over the wire: search → friend → feed visibility → react → comment → notify → DM unread → delete cascade |
| Browser console | `ndev browser exec <s> console --kind js --fail-on-error` | 0 errors |
| Production build | `pnpm build` | ✓ (Vite production bundle) |
| Publication boundary | `pnpm verify:publication` / `make publish-ready` | Go publication-tool tests, types, 28 application tests, build, production dependency licenses, and both secret-scan modes pass |

The live E2E is the same script that verifies a cloud deployment — point
`VITE_CONVEX_URL` at it and re-run.

## Domain rules worth knowing

- **Visibility lives in one function** — `lib/social.ts::postVisibleTo`; both
  `posts.feed` and `posts.forProfile` filter server-side, so a hidden post
  never reaches a client.
- **Tallies are denormalized but exact** — `reactionCounts`/`commentCount`
  move in the same mutation transaction as the child row; tests pin add /
  switch / remove arithmetic.
- **Notifications never self-ping** — `notify()` drops actor==recipient, and
  switching a reaction kind doesn't re-notify.
- **One row per pair** — friendships and conversations are keyed by a sorted
  `pairKey`, making request/accept and DM-open idempotent by construction.

## Adding to the model

1. Add a table in `convex/schema.ts`.
2. Add `query`/`mutation` functions in `convex/` and rules in `convex/lib/social.ts`.
3. Pin behavior in `convex/social.test.ts` (convex-test, runs in ms).
4. Consume from the web app via `api` from `@openbook/shared`.

## License

MIT. See [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
