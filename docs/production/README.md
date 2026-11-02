# Openbook production guide

This guide defines the production contract for Openbook. The repository can
prove the application code, deployment controls, backup tooling, and local
recovery path. It cannot prove that a public service is deployed or that real
users use it.

Use these documents in this order:

1. Read [architecture.md](architecture.md) for the service boundaries and
   failure model.
2. Read [security-and-privacy.md](security-and-privacy.md) before you create
   provider accounts or secrets.
3. Review [slo.md](slo.md) and select the `launch` or `scale` capacity profile.
4. Complete [launch-checklist.md](launch-checklist.md) with evidence from the
   target production environment.
5. Use [runbook.md](runbook.md) for deployment and incident work.
6. Execute [disaster-recovery.md](disaster-recovery.md) before launch and once
   per quarter.

The source of truth for machine-checked capacity targets is
[`production/scale-targets.json`](../../production/scale-targets.json). The
source of truth for the architectural decision is
[`KEP-006`](../keps/kep-006-production-scale.md).

## Evidence levels

Openbook uses these terms precisely:

| Term | Meaning |
| --- | --- |
| Built | The implementation exists in the repository. |
| Locally verified | The implementation passed tests or a local live check. |
| Publish-ready | The clean source and application gates pass. |
| Deployed | The exact reviewed revision is running in a named environment. |
| Launch-ready | All external controls and hosted acceptance checks pass. |
| Launched | The operator intentionally opened the service to users. |
| Scale-certified | A hosted load receipt passes one capacity profile. |

Do not promote one level to the next without its required evidence.

## Machine entry points

Run these commands from the repository root:

```text
pnpm verify:production-contract
pnpm production:readiness
pnpm production:probe
pnpm production:load -- --help
bash scripts/build-desktop.sh
bash scripts/export-backup.sh /absolute/path/openbook.zip
OPENBOOK_RESTORE_DRILL=I_UNDERSTAND bash scripts/restore-drill.sh /absolute/path/openbook.zip
```

`openbookctl` reports do not print secret values. Keep JSON receipts in a
private operations store because they can contain deployment origins, release
identifiers, and capacity information.

## Current boundary

The code uses Convex Auth only for local development. Production requires a
Clerk production instance and the supported Convex Clerk integration. Convex
documents Convex Auth as beta and warns that it can receive incompatible
changes. See the [Convex Auth status](https://docs.convex.dev/auth/convex-auth)
and the [Clerk integration guide](https://docs.convex.dev/auth/clerk).

The reviewed web deployment path is Cloudflare Pages Direct Upload. The backend
deployment path is Convex. Both paths require an explicit operator confirmation.
Nothing in this guide grants permission to deploy.
