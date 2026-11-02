# Openbook backlog

The product and repository production epic is complete when the dated evidence
receipt passes. Remaining work needs external authority or provider state. Do
not describe those gates as shipped, deployed, launched, adopted, or
scale-certified.

## Shipped in-repo (2026-08-20)

- Persistent desktop navigation and a responsive mobile bottom navigation.
- Private saved posts and a paginated notifications page.
- Named, labeled forms with submit and route-focus behavior.
- Link previews, presence, typing state, albums, and multi-image posts.
- Tauri desktop and hardened Expo mobile shells.
- HMAC `/media` CDN in front of Convex storage and `scripts/deploy.sh`.
- Current supported web and native dependency families, plus native CI.

## Production and scale in-repo (2026-08-21)

- Bounded indexed backend reads, stable pagination, and cached visibility
  evaluation.
- Exact migrated content and storage counters, per-plan upload quotas, and
  resumable orphan-file cleanup.
- DNS-pinned link-preview fetching with bounded redirects, content, time, and
  storage-proxied images. Browser push delivery uses a reviewed host allowlist.
- Resumable content cleanup, account erasure, retention, and migrations.
- Durable provider delivery with dedupe, leases, retry, and dead-job readiness.
- Stripe replay receipts and out-of-order event protection.
- Stable Clerk production identity; Convex Auth stays local-only.
- Separate liveness and dependency readiness, scheduler heartbeat, redacted
  client telemetry, security headers, CSP rendering, and release-bound assets.
- Machine-checked launch and scale profiles, synthetic load receipts, guarded
  Convex and Cloudflare deployment, verified backups, and disposable recovery.
- Architecture, SLO, security, operations, recovery, and launch acceptance
  documents in `docs/production/`.

## Still out

| Item | Home |
| --- | --- |
| App Store / Play / signed Tauri bundles | KEP-002 operator |
| Clerk production instance, custom domains, and live identity proof | KEP-006 launch checklist |
| Cloudflare and Convex hosted deployment | KEP-006 operator confirmation |
| Verified backup schedule, log stream, and alert delivery | KEP-006 operations |
| Hosted HTTP capacity certification and realtime session soak | KEP-006 capacity |
| Legal, privacy, abuse, on-call, and public registration decision | KEP-006 service owner |

## Maintenance gate

Expo 57 pins two unpatched `image-size` denial-of-service advisories through
its local Metro bundler. Runtime users cannot send input to this build tool.
`tools/mobile-audit` permits only these two advisory paths and expires the
exception on 2026-09-20. It fails on any new finding or changed path.

## Non-goals

Meta branding. Claiming a public hosted Openbook service from this repo until
KEP-006 hosted acceptance and an explicit launch decision are complete.
