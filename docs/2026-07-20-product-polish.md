# Openbook product polish — 2026-07-20

Status: **local polish shipped; `make publish-ready` green.**  
Source is public at [`nstranquist/openbook`](https://github.com/nstranquist/openbook).  
Scope of this note: the 2026-07-20 product/docs honesty + UI pass (no push that day).

## Changes

| Area | What |
| --- | --- |
| **Brand** | Replaced Meta-adjacent letter **“b”** logo with authored `openbook.svg` via `BrandMark`; favicon + apple-touch in `apps/web/public/`. |
| **Landing** | Feature list, auth card hierarchy, busy/error states, autocomplete attributes. |
| **Feed** | Skeleton loaders; empty-state CTA → Find friends. |
| **Posts** | Click reaction/comment summary to open comments; aria on Like/Comment/picker. |
| **A11y** | `:focus-visible` rings; `prefers-reduced-motion`; profile link labels; nav aria-labels. |
| **Honesty** | Root `package.json` description is **web-only** (no mobile/desktop suite claim). |
| **Docs** | Test counts aligned to **28** (README, CONTRIBUTING, case study, readiness). |

## Verification

```sh
make publish-ready   # EXIT 0 on 2026-07-20
```

## Still human-gated (J1)

1. Diff review of local tree (prefer clean `make export-publication OUT=…`).
2. Create/push `nstranquist/openbook`.
3. Public CI green + signed-out review → pin #2.

Optional residual: live Convex E2E re-run (`scripts/verify-live.mjs`) when selfhost is up; richer multi-user portfolio screenshot for recruiters.
