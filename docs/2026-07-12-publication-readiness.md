# Openbook publication readiness

Status: **public source released** (`nstranquist/openbook`).  
Owner: `nstranquist`  
Reviewed: 2026-07-13 · re-verified **2026-07-20** (`pnpm verify:publication` + clean export, 93 files)

## Cleared locally

- Root MIT license covers Nico-authored application code.
- The only Git commit author is `nstranquist`; no excluded prior-employer
  identity, domain, source, or asset is present.
- Root package metadata declares the same MIT license as `LICENSE`.
- Full-history and working-tree gitleaks scans pass. The historical Stripe curl
  finding was a runtime variable, not a committed credential; the narrow
  path-and-line allowlist documents it, and current code uses a Bearer header.
- Production dependency licenses are limited to reviewed permissive families;
  `tools/license-audit` fails closed on unknown licenses or unpublished
  `@nicos` packages.
- The application no longer depends on packages linked from `nicos-tools`.
  Garrid CSS and the required theme/toast adapter are vendored as Nico-owned MIT
  source, so a clean checkout is independently installable.
- `convex/_generated` is included in the publication tree, allowing a fresh
  checkout to typecheck and test before any Convex deployment is provisioned.
- Facebook/Meta comparative branding was removed from product copy and source
  comments. No Facebook or Meta code, logos, images, or assets are present.
- Both Go publication-tool suites, typecheck, Convex tests, production
  build, license audit, and both secret-scan modes pass through
  `pnpm verify:publication`.
- `.github/workflows/ci.yml` runs the publication gate on the public repo.
- A fresh publication export with one `nstranquist`-owned initial commit passed
  frozen install, the full publication gate, and the durable marker scan on
  2026-07-13. Publish from that reviewed tree, not the older local Git history.
- Reproduce the reviewed tree with
  `pnpm export:publication -- --out /path/to/empty-directory`; the Go exporter
  rejects in-repository and non-empty destinations and emits a content digest.

## Remaining human gates

Deployment and profile-pin changes stay operator-owned. The source repository
is already public.
