# Openbook backlog

The product-code backlog is complete in this repository. Remaining work is
operator execution: store signing and a hosted public userbase.

## Shipped in-repo (2026-08-20)

- Persistent desktop navigation and a responsive mobile bottom navigation.
- Private saved posts and a paginated notifications page.
- Named, labeled forms with submit and route-focus behavior.
- Link previews, presence, typing state, albums, and multi-image posts.
- Tauri desktop and hardened Expo mobile shells.
- HMAC `/media` CDN in front of Convex storage and `scripts/deploy.sh`.
- Current supported web and native dependency families, plus native CI.

## Still out

| Item | Home |
| --- | --- |
| App Store / Play / signed Tauri bundles | KEP-002 operator |
| Hosted production userbase | KEP-003 `OPENBOOK_DEPLOY=I_UNDERSTAND` |

## Maintenance gate

Expo 57 pins two unpatched `image-size` denial-of-service advisories through
its local Metro bundler. Runtime users cannot send input to this build tool.
`tools/mobile-audit` permits only these two advisory paths and expires the
exception on 2026-09-20. It fails on any new finding or changed path.

## Non-goals

Meta branding. Claiming a public hosted Openbook service from this repo
until KEP-003 is executed by a human.
