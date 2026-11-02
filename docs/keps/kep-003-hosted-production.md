# KEP-003 — Hosted production

- Status: accepted, operator-gated
- Date: 2026-08-20

KEP-006 supersedes this document's in-repository production design. This file
remains as the original hosted-service decision and authority boundary.

## Decision

This repository does **not** claim a public Openbook service. Production uses
the KEP-006 contract. It requires Clerk production identity, Convex, a verified
email provider, explicit billing and push modes, Cloudflare edge controls,
backups, log streaming, readiness, and hosted acceptance proof.

No synthetic fixtures in the production deployment. No real user data
in git.

The repository provides `/status` with no SLA, separate `/health` and `/ready`,
signed `/media`, durable provider work, backup and restore tooling, scale
targets, and guarded deployment scripts. It does not claim a public service.

## Acceptance (in-repo — current)

- Unauthenticated `/status` states this is a personal project with no SLA.
- `GET /health` reports liveness and the immutable release.
- `GET /ready` fails closed on stale maintenance, configuration, migrations,
  durable delivery, and account erasure.
- `scripts/export-backup.sh` verifies a full snapshot and private manifest.
- `scripts/restore-drill.sh` proves local import and restored readiness.
- `go-live-check.sh` validates the explicit production environment contract.

## Acceptance (hosted userbase — future, human-gated)

- Complete `docs/production/launch-checklist.md` for the exact release.
- Preserve provider, backup, load, realtime soak, browser, and alert receipts.
- Obtain an explicit service-owner launch decision.
