# KEP-003 — Hosted production

- Status: accepted, operator-gated
- Date: 2026-08-20

## Decision

This repository does **not** claim a public Openbook service. Production
is: `npx convex deploy`, `SITE_URL`, Stripe live keys, Resend, OAuth,
then `bash scripts/go-live-check.sh`.

No synthetic fixtures in the production deployment. No real user data
in git.

The in-repo slice that *is* shipped: public `/status` (no SLA), HTTP
`/health`, signed `/media` cache, `scripts/export-backup.sh`, and
`scripts/deploy.sh` (refuses unless `OPENBOOK_DEPLOY=I_UNDERSTAND`).

## Acceptance (in-repo — current)

- Unauthenticated `/status` states this is a personal project with no SLA.
- `GET /health` on the Convex HTTP router returns `{ ok: true }`.
- `scripts/export-backup.sh` documents and runs an export when the CLI
  supports it.
- `go-live-check.sh` warns when Resend / SITE_URL / operator ids are unset.

## Acceptance (hosted userbase — future, human-gated)

- go-live-check green against live env with live Stripe.
- Backup / export path executed by the operator, not by CI.
- Status page reachable at the public origin.
