# Production runbook

## Operator rules

- Work from a clean, dedicated release checkout.
- Never deploy an unreviewed or moving revision.
- Never paste secrets into a command transcript or issue.
- Save all receipts in the private operations store.
- Do not bypass a failed readiness, migration, backup, or probe gate.

## Before each deployment

1. Select the `launch` or `scale` capacity profile.
2. Confirm that the current backup age is within the selected profile target.
3. Confirm that the log stream and alerts receive a recent test event.
4. Run `pnpm install --frozen-lockfile` in the clean release checkout.
5. Run `make publish-ready`.
6. Export the production environment contract in the operator shell.
7. Set `OPENBOOK_RELEASE` to the exact output of `git rev-parse HEAD`.
8. Run `pnpm production:readiness`.
9. If billing is enabled, use `--online` to verify live Stripe price access.
10. Review migrations, schema compatibility, and rollback constraints.
11. If the required counter and storage migration is incomplete, drain
    application writes.
12. Set `OPENBOOK_MIGRATION_TRAFFIC_DRAINED=I_UNDERSTAND` only after writes are
    drained.
13. Announce the change window and the prior known-good release.

Do not record the environment output. The readiness tool reports names and
states without printing values.

## Backend deployment

The operator must explicitly authorize the deployment:

```text
OPENBOOK_DEPLOY=I_UNDERSTAND bash scripts/deploy.sh
```

The script performs these actions:

1. Refuses a dirty checkout or release mismatch.
2. Runs the local production readiness check.
3. sets Clerk production identity configuration on Convex.
4. Deploys Convex functions and builds immutable web assets.
5. Sets the production environment and release marker.
6. Requires a traffic-drained confirmation for an incomplete migration.
7. Starts and waits for the required user statistics and storage migration.
8. Writes a scheduler heartbeat and dispatches pending delivery work.
9. Runs each required storage and retention loop once.
10. Requires `/ready` to return success.

If any step fails, stop. Do not publish the web build.

## Web deployment

Use an existing Cloudflare Pages Direct Upload project. Set the project,
production web environment, Convex origins, Clerk publishable key, exact Clerk
issuer, and exact release. Then run:

```text
OPENBOOK_DEPLOY=I_UNDERSTAND bash scripts/deploy-web.sh
```

The script reruns the publication and readiness gates. It builds the web client
and renders the exact Clerk, Convex application, Convex HTTP-action, and Convex
WebSocket origins into `_headers`. It uploads the immutable revision and runs
the live probe.

After the script passes, use a new browser profile. Check sign-up, sign-in,
sign-out, recovery, and MFA. Check one social write and realtime delivery in a
second session. Check media, settings, and account erasure. Check desktop and
mobile viewport layouts. Save the release and result, but do not save user
secrets.

## Desktop build

Use the same clean release checkout and production environment. Run
`bash scripts/build-desktop.sh`. The script repeats the publication and
readiness gates. It builds the production web assets and renders an exact Tauri
CSP. It then builds an unsigned optimized application. Inspect the generated
CSP. Test Clerk, Convex, media, and realtime traffic in the application.

Code signing, notarization, installers, and store submission need the approved
operator identity and signing service. Do not describe the unsigned application
as a published installer.

## Normal checks

Review these values every day:

- `/health` release and environment.
- `/ready` dependency fields.
- Dead and overdue delivery jobs.
- Delivery dispatcher timestamp and `staleMaintenanceJobs`.
- Stale account erasure jobs.
- Required migration state.
- Storage bytes, upload counts, provider storage use, and orphan-file deletions.
- Client error fingerprint rate by release.
- Provider quotas, error rates, and latency.
- Latest verified backup age and off-provider copy state.

Run a complete restore drill once per quarter and before a high-risk schema
change.

## Triage

### Readiness fails

Read the bounded `/ready` fields. Check them in this order:

1. `configuration`: compare deployment variables with the contract. Do not
   print secret values.
2. `migrations`: run `migrations:userStatsStatus`. The watchdog can resume stale
   work. Do not mark the migration complete by hand.
3. `maintenance`: read `staleMaintenanceJobs`. Run only the named internal
   maintenance entry point, then find why its cron stopped. The names map to
   `gc:unusedUploads`, `gc:orphanedStorage`, `gc:expiredStories`, and
   `maintenance:pruneEphemeral`. If the list is empty, run `health:heartbeat`.
4. `delivery`: run `delivery:dispatch`, then inspect the dispatcher timestamp,
   private provider logs, and dead or overdue job metadata.
5. `accountDeletion`: inspect the stale job phase and last bounded error.
6. `database`: use the Convex provider status and deployment logs.

Restore traffic only after `/ready` remains healthy for five minutes.

### Durable delivery is dead

Identify the provider kind and the sanitized last error. Verify provider health,
credentials, sender/domain status, quota, and payload policy. Correct the cause
first. Run `npx convex run --prod delivery:retryDead '{"jobId":"..."}'` for
the named job. If the work must be abandoned, record the reason with
`delivery:cancelDead`. Do not edit the database from an unrecorded console
action. A repeat provider call must be safe or explicitly deduplicated.

### Account erasure is stale

Find the job by internal user ID. Record its phase, failure count, and last
error. If the phase is `external_identity`, check the Clerk deletion delivery.
If it is `subscriptions`, check Stripe cancellation. Correct the dependency and
let the watchdog resume the job. Do not delete the erasure receipt until the
job is complete.

### Client errors rise after a release

Group by release and fingerprint. Reproduce with the production CSP and a new
browser profile. Check lazy chunk loading, service-worker cache state, Clerk,
Convex, and signed media. If the backend contract is unchanged, roll back the
web assets. If old web code is incompatible with the active schema, use a
forward fix.

## Rollback

Cloudflare assets are immutable per release. Restore the prior known-good Pages
deployment through the Cloudflare deployment history, then run the production
probe against that revision.

For Convex functions, first decide whether the prior functions are compatible
with the current schema and data. If they are compatible, deploy the prior
reviewed commit from a new dedicated checkout and use its exact release value.
If they are not compatible, deploy a forward fix. Never reverse or delete data
without a tested recovery plan.

After any rollback, verify `/health`, `/ready`, Clerk sign-in, a read, a write,
realtime propagation, delivery health, and client error rate. Record both
release identifiers.

## Incident severity

| Severity | Example | Response |
| --- | --- | --- |
| SEV-1 | Data exposure, destructive corruption, or service-wide failure | Page now, contain traffic, preserve evidence, start incident command. |
| SEV-2 | Major feature or dependency unavailable with broad impact | Page now, mitigate within the active SLO budget. |
| SEV-3 | Limited degradation or isolated failed work | Assign an owner during the same working day. |
| SEV-4 | Cosmetic or low-risk operational defect | Track in normal planning. |

The incident commander owns user communication and the decision to restore
traffic. The operator records each production command and exact release. The
operator also records the time, result, and reviewer in the private incident
log.
