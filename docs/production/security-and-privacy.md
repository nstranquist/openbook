# Security and privacy controls

## Security boundary

Treat the browser, uploaded files, webhooks, and provider callbacks as
untrusted. Convex functions must make every authorization decision. Do not put
private data or secrets in Vite variables, browser logs, client telemetry,
Cloudflare assets, Git, or public evidence.

## Identity

Production uses Clerk with live keys and an exact HTTPS issuer. The Convex auth
configuration accepts the `convex` Clerk JWT template. The application verifies
the configured issuer before it creates an internal user mapping.

Configure these Clerk controls before launch:

- Use a production Clerk instance and live keys.
- Configure a custom Frontend API domain.
- Enable the required email verification and recovery flows.
- Require MFA for operator accounts. Decide whether MFA is optional or required
  for other users, then record the decision.
- Restrict allowed origins and redirect URLs to the production web origin.
- Disable development instances, test keys, and broad wildcard origins.
- If the selected plan provides webhook or audit retention, configure it.

Convex Auth remains available for local dogfood only. Do not set
`OPENBOOK_AUTH_MODE=convex-auth` in production.

## Secrets

Store backend secrets in the Convex production environment. Store Cloudflare
credentials in the operator secret store or protected CI environment. Store
Clerk publishable keys in the web build environment. A publishable key is not a
secret, but it must still belong to the correct production instance.

Use separate random values for:

- `MEDIA_SIGNING_SECRET`
- `OPENBOOK_SYNTHETIC_KEY`
- `CLIENT_ERROR_HASH_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- VAPID private key

Do not derive one key from another. Rotate a key after disclosure, suspected
disclosure, operator departure, or provider incident. Record the rotation date
and affected release in the private incident log.

The production readiness tool checks presence and safe shape. It does not print
secret values. It cannot prove that a secret has correct provider permissions.

## Web and transport controls

Cloudflare must redirect HTTP to HTTPS. The rendered `_headers` file sets CSP,
HSTS, content-type protection, clickjacking protection, a referrer policy, and a
permissions policy. The CSP includes only the exact Clerk Frontend API, Convex
application, Convex HTTP-action, and Convex WebSocket origins, plus Clerk's
documented challenge origins. It rejects wildcard Convex deployments. Render it
during deployment. Do not commit a real tenant origin to the source template.

Run the strict production probe after each web deployment. A missing required
header makes the probe fail. Also verify headers in a real browser because a
static header can still block a Clerk, Convex, or media request.

The Tauri local config permits only loopback HTTP and WebSocket origins. A
production desktop build must use `scripts/build-desktop.sh`. That script
renders exact provider origins into a generated config before it builds the
optimized application. Do not package the local Tauri config for production.

## Application controls

- Indexed, bounded reads prevent table-size amplification.
- Server-side visibility checks prevent hidden content from reaching a client.
- Per-action rate limits protect write paths and client error ingestion.
- Upload ownership, exact byte and file-count quotas, strict media-type limits,
  and signed, expiring media URLs protect stored files. Upload admission records
  the user, declared byte size, and media kind before it returns a provider URL.
  Registration must consume the same active grant and match the actual file.
  One user can hold at most four active grants. Untracked files older than 15
  minutes have a bounded deletion path. The media response also disables content
  sniffing and active content execution. It supports one bounded byte range.
  Signed URLs and their cache lifetime are at most one hour. The 19 MB video
  limit stays below the provider's
  [20 MiB HTTP-action response limit](https://docs.convex.dev/production/state/limits).
- Link-preview fetches reject credentials, custom ports, special hosts, and
  non-global IP addresses. Each redirect gets a new DNS check. The connection
  uses the validated address to prevent DNS rebinding. Time, redirect, media
  type, and byte limits apply before Openbook stores an accepted raster image.
- Browser push subscriptions accept only the reviewed FCM, Mozilla, Apple, and
  Windows push host families. Subscription list responses omit endpoints and
  private key material.
- Stripe webhook signatures, event receipts, and event time ordering protect
  subscription state.
- A private bearer key protects the synthetic load endpoint. An invalid key
  gets `404` to avoid advertising the endpoint.
- The durable outbox prevents provider calls from being lost between a database
  commit and a worker invocation.
- Account erasure removes the Clerk identity, authentication records, social
  data, uploads, and user-linked operational rows in resumable batches.
- Account closure immediately denies application reads and new social writes
  while the resumable erasure job removes the remaining rows. Report creation
  requires visible content, checks the reported target, and deduplicates open
  reports.

## Data classification and retention

| Class | Examples | Rule |
| --- | --- | --- |
| Public | Public profiles and public posts | Return only through server visibility checks. |
| Social-private | Friend posts, messages, notifications, groups, events | Never place in client telemetry or public evidence. |
| Identity | Email, Clerk ID, session and verification data | Limit to identity and erasure flows. |
| Financial | Stripe customer and subscription IDs | Store provider identifiers, not card data. |
| Operational-sensitive | Source hashes, error fingerprints, release and capacity receipts | Keep in private operations storage. |
| Secret | API keys, signing keys, webhook secrets | Use the secret store only. Never log or return the value. |

Code retains rate-limit windows for 24 hours and typing rows for 10 minutes.
Code retains notifications and Stripe webhook receipts for 90 days. Code
retains delivery receipts, client errors, and completed erasure receipts for
30 days. Bounded deletion paths remove replaced preview images, unused
registered uploads, and old untracked storage files. Backups can retain deleted data
until the backup retention window expires. State this fact in the user privacy
notice.

## Abuse and moderation

Application rate limits are one layer. Before public launch, also enable the
provider's abuse controls and quotas for Convex HTTP actions, Clerk sign-in,
Cloudflare, Resend, and Stripe. Start with conservative limits and record any
exception.

At least one tested operator ID is required for report review. Define an abuse
contact, response target, evidence-retention rule, and appeal path. Do not put
raw moderation evidence in public issue trackers.

## Supply chain

The publication gate runs type checks, application tests, production builds,
license review, dependency audit, and secret scans. CI dependencies are pinned.
The deployed release must be the exact clean Git commit named by
`OPENBOOK_RELEASE`.

Review newly published dependency versions before adoption. A zero audit result
does not prove that a dependency is trustworthy. Preserve lockfiles and use
frozen installs for release work.

## Security incident minimum response

1. Stop or limit the affected traffic path.
2. Preserve private logs and the exact release identifier.
3. Rotate exposed credentials from the provider side.
4. Revoke affected sessions and tokens.
5. Deploy a reviewed fix or compatible rollback.
6. Check account erasure, delivery, migration, maintenance, storage, and backup
   health.
7. If the applicable policy or law requires notification, notify affected users
   and authorities.
8. Write a private incident review with cause, scope, timeline, and controls.

Legal requirements depend on the launch location and userbase. Complete a
privacy and terms review before opening registration. Repository tests cannot
complete that review.
