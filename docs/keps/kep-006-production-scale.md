# KEP-006: Production and scale contract

- Status: accepted and implemented in the repository. Hosted acceptance is
  operator-gated.
- Date: 2026-08-21
- Supersedes: the in-repository parts of KEP-003

## Problem

The application had broad product behavior, but product completeness did not
prove production safety. The earlier hosted plan had a liveness endpoint and
operator confirmation. It did not define bounded data access, durable provider
work, readiness dependencies, stable identity, recovery objectives, scale
measurements, or a complete launch review.

## Decision

Openbook adopts one machine-checked production contract and two capacity
profiles. Production uses Cloudflare Pages for immutable web assets, Clerk for
identity, and Convex for application data, realtime functions, files, scheduled
work, and HTTP actions.

Convex Auth stays in the local developer path. It is not the production identity
path because Convex documents it as beta and subject to incompatible changes.

All production backend reads are indexed and bounded. Exact denormalized counts
replace unbounded badge and cardinality scans. Accepted friendships use a
two-row adjacency index so one user list needs only one paginated query.
Required data changes run as resumable migrations. Large deletion and retention
operations use bounded, restartable jobs.

The initial counter and storage-usage rebuild requires a prelaunch or
traffic-drained window. It uses multiple bounded transactions and does not claim
cross-transaction snapshot isolation. Production rejects reset requests after
the migration is complete.

Uploads use exact byte and file-count quotas. A bounded admission grant reserves
declared usage before the provider returns an upload URL. The user, media kind,
storage ID, and actual byte size must match before registration consumes the
grant.
Bounded maintenance removes stale registered uploads and untracked storage
files. Link-preview fetches reject
special network targets, pin validated DNS results, bound redirects and bodies,
and store accepted preview images behind signed Openbook media URLs. Push
delivery accepts only reviewed browser push service hosts.

Critical external effects use a durable, deduplicated outbox with leases,
backoff, dead-job state, typed retry and cancellation controls, and readiness
integration. Stripe webhooks have replay receipts and event ordering. Account
erasure includes the external identity and provider cancellation paths.

The service exposes separate liveness and readiness endpoints. Readiness covers
the database, configuration, scheduler heartbeat, individual storage and
retention loops, migration, delivery dispatcher and queue, and account erasure
progress.

Web and desktop publication use CSPs rendered with exact Clerk and Convex
origins. Web delivery also uses strict security headers, an SPA fallback,
release-bound service-worker assets, and a dirty-tree deployment refusal. The
unsigned optimized Tauri build uses the same exact provider boundary. Signed
media covers video and supports bounded range reads below the provider HTTP
response limit.

## Capacity decision

The versioned contract in `production/scale-targets.json` defines:

- provider session limit.
- planned concurrent application sessions.
- synthetic HTTP worker count and minimum request rate.
- read and write p95.
- error rate and availability objective.
- minimum load duration.
- maximum backup age and recovery time objective.

An HTTP load test can certify only `synthetic_http`. A separate realtime session
soak and current provider-limit receipt are required for scale certification.

The `launch` profile allows a verified daily or hourly backup. The `scale`
profile requires a verified hourly backup. Both require provider log streaming
and tested alerts.

## Rejected options

### Use Convex Auth in production

Rejected for this production baseline because its official status is beta. The
local path remains useful for offline dogfood.

### Treat scheduled actions as durable delivery

Rejected. A scheduled action alone does not provide a visible lease, bounded
retry policy, dead-job state, or dedupe receipt.

### Prove scale with concurrent HTTP workers only

Rejected. HTTP request concurrency and realtime connected sessions measure
different provider resources.

### Deploy from a developer checkout

Rejected. Release scripts require a clean checkout and an exact immutable Git
revision.

### Mark production complete after local proof

Rejected. Provider accounts, domains, live authentication, log streams,
backups, hosted load, realtime soak, legal review, and public traffic need
external evidence and explicit authority.

## Repository acceptance

- Production source audit rejects unbounded Convex reads and direct critical
  provider scheduling.
- Required counters and storage quotas, migrations, cleanup jobs, delivery
  outbox, retention, health, readiness, telemetry, and scale probe exist and
  have tests.
- Link-preview and push egress have explicit host, protocol, redirect, byte,
  time, and storage boundaries.
- Production Clerk identity and external account deletion are implemented.
- Production environment validation fails closed and does not print secrets.
- Backup verification and a disposable restore drill cover tables and files.
- Web edge controls and web and Tauri CSP rendering are machine-checked.
- Deployment scripts refuse a dirty or mismatched revision.
- Architecture, SLO, security, runbook, recovery, and launch documents exist.
- The complete publication gate and local live proof pass on the final revision.

The last item needs a dated evidence receipt. Do not change this KEP status to
hosted, launched, adopted, or scale-certified from repository evidence.

## Hosted acceptance

Hosted acceptance requires every applicable item in
`docs/production/launch-checklist.md`. Required evidence includes live Clerk,
Cloudflare, Convex plan, session limits, email, billing, push, logs, backup,
restore, probe, browser, load, realtime soak, and alerts. An operator launch
decision is also required.

## Consequences

The production path has more provider configuration and operating work than the
local path. This is intentional. Local development stays simple and offline.
Production failures become visible and recoverable, but the operator must own
provider limits, cost, on-call response, legal policy, and deployment authority.
