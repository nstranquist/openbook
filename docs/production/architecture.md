# Production architecture

## Purpose

Openbook is a realtime social application. The production design separates the
web edge, identity provider, application backend, and external delivery
providers. Each state change has one authoritative owner.

```text
Browser or installed client
  -> Cloudflare Pages: immutable web assets, SPA fallback, security headers
  -> Clerk: sign-in, sessions, MFA, password recovery
  -> Convex: authorization, social data, realtime queries, files, jobs, HTTP actions
       -> Resend: transactional email
       -> Stripe: optional live billing
       -> Web Push: optional notifications
       -> Clerk API: account erasure
  -> private log destination: Convex log stream and alerts
  -> private backup destination: daily Convex snapshot and manifest
```

Cloudflare must not contain application database logic. Clerk owns production
credentials and sessions. Convex owns the internal user record and all social
authorization. A Clerk identity maps to one internal user through the
`externalIdentities` table.

## Request paths

The web client loads static assets from Cloudflare. It opens reactive Convex
queries for application data. Mutations enforce access rules on the server. A
client never decides whether a post, comment, message, group, or event is
visible.

The Convex HTTP router has these production endpoints:

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /health` | Process and release liveness | Public, no private detail |
| `GET /ready` | Database, scheduler, migration, delivery, deletion, and configuration readiness | Public, bounded result |
| `POST /client-errors` | Redacted browser error envelopes | Origin-limited and rate-limited |
| `POST /stripe/webhook` | Signed Stripe state changes | Stripe signature |
| `POST /ops/load` | Synthetic read and write probe | Independent bearer secret |
| `GET /media` | Signed file delivery | HMAC, expiry, and ownership-derived URL |

The health endpoint can stay live while readiness is false. A load balancer or
operator must use `/ready` for traffic decisions.

## Data and query model

Production query code must use an index and a bounded terminal operation such
as `paginate`, `take`, `first`, or `unique`. The source audit rejects `.collect()`
and database `Query.filter` calls in production Convex modules. This rule keeps
read cost bounded as table size grows.

Openbook stores exact denormalized counts for feed cards, badges, groups,
events, albums, and conversations. Mutations change the parent count in the
same transaction as the child row. Exact `storageBytes`, `uploadCount`, and
`friendCount` counters enforce quotas without a table scan. Upload URL admission
reserves the declared byte and file usage in a short-lived grant. Registration
must present that grant and match its user, media kind, storage identifier, and
exact byte size. One user can hold at most four active grants.

The resumable `user-stats-v4` migration builds required counters, stored-file
sizes, and accepted-friend adjacency for older data. It removes duplicate
accepted friendship rows before it marks friend counts exact. `/ready` stays
false until that migration is complete. The initial rebuild scans live rows
across bounded transactions. Run it before launch or while application writes
are drained. Production rejects a reset of this migration.

Large cleanup work uses bounded batches. This includes post and event purges,
account erasure, migrations, and retention work. Each job records progress and
schedules the next batch. Separate sweeps remove unused registered uploads and
storage files older than 15 minutes that have no ownership record. A resumable
cursor prevents a large storage table from making one transaction unbounded.

Feed, profile, friend, message, group, event, album, block, mute, and report
lists use opaque bounded cursors. Each accepted friendship creates two
materialized `friendEdges` rows in the same transaction. This model lets one
user's complete friend list use one paginated index query. Visibility
evaluation caches the viewer's block, mute, friend, and group relationships
within one request. It does not repeat the same point read for each post on a
page.

## Untrusted outbound data

Link-preview URLs are untrusted. The parser permits only plain HTTP or HTTPS
origins without credentials, custom ports, or special network names. The Node
fetch action resolves every address and rejects non-global IPv4 and IPv6
ranges. It connects to a validated address and keeps the original TLS server
name. It repeats validation after each bounded redirect. It also limits time,
media type, declared size, and streamed bytes.

The browser never receives the fetched third-party preview image URL. Openbook
copies an accepted raster image into owned Convex storage and returns a signed
Openbook media URL. Stale or replaced preview images are deleted. Browser push
subscriptions accept only the reviewed FCM, Mozilla, Apple, and Windows push
host families. Private subscription keys and endpoints are not returned by the
subscription list query.

All production post images, preview images, stories, album covers, and videos
use signed Openbook media URLs. The media route supports one bounded byte range
for video seeking. Videos have a 19 MB limit so every full response stays below
the Convex [20 MiB HTTP-action response limit](https://docs.convex.dev/production/state/limits).
If the exact media origin or signing secret is missing, production fails closed.

## External side effects

An application mutation does not call a critical external provider directly.
It writes a deduplicated `deliveryJobs` row first. A dispatcher leases a bounded
batch. A worker then calls Resend, Web Push, Stripe, or Clerk.

Failed work returns to `pending` with exponential backoff. A processing lease
recovers an interrupted worker. Eight failed attempts make a job `dead` and
make `/ready` fail. A late worker can only complete a job that is still in the
`processing` state.

Stripe webhook event IDs are receipts. Duplicate events are no-ops. The stored
Stripe event creation time prevents an older delivery from replacing newer
subscription state.

## Account erasure

Account erasure has two stages:

1. The first transaction tombstones the public profile, removes direct identity
   fields, resets counts, and queues external cancellation work.
2. A resumable job removes sessions, identity rows, content, graph edges,
   messages, notifications, uploads, rate limits, and provider identity.

The Clerk user deletion must succeed or return `404` before the external
identity mapping is removed. Stripe cancellation work remains durable after the
internal user relationship is removed. A watchdog resumes stale erasure jobs.
An erasure job becomes stale after 20 minutes without progress. A stale job
makes `/ready` fail.

## Web delivery

The production web build uses route and authentication-provider chunks. The
edge serves an SPA fallback and release-bound service-worker assets. The CSP is
rendered from the exact Clerk Frontend API, Convex application, Convex HTTP
action, and Convex WebSocket origins before upload. It does not permit a
wildcard Convex deployment. Other security headers are static and
machine-audited.

The Tauri source configuration permits only local dogfood origins. The
production desktop build generates a separate config with the exact Clerk,
Convex application, Convex HTTP-action, and Convex WebSocket origins. The
optimized application build consumes that config. Signing and installer
publication remain separate operator actions.

The deployment scripts refuse a dirty checkout. They also require
`OPENBOOK_RELEASE` to equal the exact Git commit. The Convex deployment runs the
required migration, seeds each maintenance loop, and checks `/ready` before it
permits the web deployment. Readiness checks the scheduler heartbeat, each
storage and retention loop, the delivery dispatcher and queue, account erasure,
configuration, and the required migration.

## Capacity model

The `launch` and `scale` profiles separate three different values:

- `provider_session_limit` is the verified provider limit for the selected
  plan or deployment class.
- `target_concurrent_sessions` is the application planning target.
- `synthetic_concurrency` is the number of HTTP load workers used by the
  repository load tool.

An HTTP load receipt does not prove realtime session capacity. Before a profile
is scale-certified, the operator must also run a hosted realtime session soak
and save provider-limit evidence.

## Main failure modes

| Failure | Expected behavior |
| --- | --- |
| Web edge unavailable | The backend stays isolated. Restore or roll back static assets. |
| Clerk unavailable | Existing backend data stays intact. New authentication can fail. |
| Convex unavailable | The web status asset can load. Application reads and writes fail closed. |
| Scheduler stale | `/ready` fails after 20 minutes. |
| Storage or retention loop stale | `/ready` lists the stale loop and fails after 45 minutes. |
| Delivery provider unavailable | Durable jobs retry. Dead or overdue jobs fail readiness. |
| Migration incomplete | `/ready` fails. The watchdog resumes stale work. |
| Account erasure stalled | `/ready` fails. The watchdog resumes the exact phase. |
| Bad release | Deploy the prior immutable web revision and redeploy prior Convex functions. |
