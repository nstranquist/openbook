# KEP-001 — Complete the Openbook backlog

- Status: shipped (2026-08-20; `pnpm test` 57/57, `pnpm typecheck` clean)
- Date: 2026-08-20
- Product: Openbook (`~/tools/openbook`)

## Problem

The senior-quality bar closed trust holes. The product still lacked
verification, billing cancel-on-close, occupancy for pair rows, mute,
privacy, reports, stories/groups/events, post search, and honest
documentation of native clients and hosted production.

## Decision

Ship the backlog in this repository as one Convex schema with server
rules and tests. Native iOS/Android/desktop remain a **separate** KEP
(KEP-002). Hosted production remains operator-gated (KEP-003).

## Acceptance

- Closed accounts cannot write; sessions and refresh tokens are deleted;
  Stripe is cancelled when a subscription id exists.
- Sign-up verification and password reset share Resend when configured.
- Uploads are owned, rate-limited, and unused blobs are GCd.
- Mute hides feed items without unfriending. Block remains the hard gate.
- Profile bio and friend-list visibility are server-enforced.
- Comments paginate. Messages can be edited; threads can be hidden;
  last-read timestamps are per-member.
- Reports exist as a queue. Groups, stories (24h), and events have
  membership and visibility rules.
- Posts are full-text searchable. Video is the same storage path as
  images with a video content-type check.
- `docs/BACKLOG.md` lists only what is still out.

## Non-goals

Facebook/Meta branding. A public hosted userbase. Shipping App Store
binaries from this repo.
