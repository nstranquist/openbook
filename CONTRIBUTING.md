# Contributing to Openbook

Realtime social network on Convex. Local-first development; publication is
human-gated.

## Setup

```sh
pnpm install
make test                 # convex-test social + billing unit tests
make verify               # typecheck + test + build
# Optional live backend:
CONVEX_PORT=3310 CONVEX_SITE_PORT=3311 pnpm selfhost
```

## Agent-oriented layout

| Path | Role |
| --- | --- |
| `convex/` | Schema + mutations/queries + domain rules |
| `convex/lib/social.ts` | Pair keys, visibility, tallies, notify fan-out |
| `convex/social.test.ts` | Rule pinboard — edit tests with any rule change |
| `packages/shared/` | Zod inputs, reaction registry, API re-export |
| `apps/web/` | Vite + React social UI |
| `tools/` | license-audit + publication-export (Go) |

## Domain rules (read before changing feed/friends/DMs)

1. **Visibility** lives in `postVisibleTo`. Feed, profile, `posts.get`,
   comments, and reactions all use it.
2. **Tallies** (`reactionCounts`, `commentCount`) update in the same mutation as the child row.
3. **Notifications never self-ping**; reaction kind switches do not re-notify.
4. **One row per pair** for friendships and conversations (`pairKey`).

## Publication

```sh
make verify-publication
make export-publication OUT=/tmp/openbook-public   # clean one-commit tree
```

Do not push from older local Git history without the export path. No public
remote mutation from this checklist.

## Token efficiency for agents

Prefer reading `docs/case-study.md` + this file + `convex/lib/social.ts` over
whole-app greps. Use `pnpm test` for regression; reserve live E2E for rule
changes that touch HTTP or auth.
