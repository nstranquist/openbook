# Production and scale local verification

- Date: 2026-08-21
- Workspace base: `5edf7d184dfebd64d9e5e1471b9e85dd9f2465e4`
- WIP lane: `openbook-production-scale`
- Host toolchain: Node `v24.13.1`, pnpm `11.22.0`, and Go `1.26.7
  darwin/arm64`
- Convex image digest:
  `sha256:1f2044e3eac463ac78973b136c0baf72d4ada602611d853d6f99f280e29e0a98`
- Evidence level: built, locally verified, and publish-ready

This receipt does not claim a hosted deployment, public launch, user adoption,
SLA, revenue, or scale certification.

## Repository gates

`make publish-ready` passed on the final working state. It included these
results:

| Gate | Result |
| --- | --- |
| Go tools | License audit, mobile audit, production control, and publication export tests passed. |
| Production source audit | 53 Convex production files passed the bounded-read, provider-delivery, web-edge, and desktop-build checks. |
| Capacity contract | Schema `1.2.0`, `launch`, and `scale` passed. |
| Production environment contract | Synthetic non-secret launch and scale configurations both passed 21 checks. |
| Dependency security | `pnpm audit --audit-level high` found no known vulnerability. |
| TypeScript | A forced run passed 2 of 2 packages. |
| Application tests | 19 files and 125 tests passed. |
| Production build | Vite built 290 modules. The initial entry was 209.04 kB and 65.31 kB gzip. |
| Production licenses | 0BSD 1, Apache-2.0 3, BSD-2-Clause 1, BSD-3-Clause 1, ISC 3, MIT 44, MPL-2.0 1. |
| Secret scans | Git history and the final working tree had no finding. The scanner excludes the ignored local Convex state directory. |
| Expo | 21 of 21 Doctor checks passed. The reviewed Metro exception covers 2 build-tool advisories until 2026-09-20. iOS and Android production bundles exported. |
| Tauri | Desktop npm audit found no vulnerability. Tauri CLI `2.11.4`, locked Cargo check, and the optimized arm64 application build passed. |

The production Clerk and local Convex Auth providers build as separate lazy
chunks. The local authentication chunk was 13.67 kB. The Clerk dependency chunk
was 118.09 kB. The initial entry does not contain both provider interfaces.

The web edge renderer bound the CSP to exact Clerk, Convex application, Convex
HTTP-action, and Convex WebSocket origins. The production Tauri config renderer
used the same exact provider boundary. The optimized test binary contained the
named test origins and no generic HTTPS or secure WebSocket connect source. The
source Tauri config permits only loopback network origins for local dogfood.

The final Tauri binary was an unsigned 8,510,848-byte arm64 Mach-O application.
Its local SHA-256 was
`eed099a80f7bec716037e85e1625efe3bbb5725789a0d2ebb5691f72001ead4d`.
Signing, notarization, and installer publication were not performed.

## Real backend

The final Convex functions compiled against the pinned local backend. The
required `user-stats-v4` counter, storage, and friend-adjacency migration
reported `complete` with 428 processed records. A migration test also proved
that a duplicate accepted friendship is removed before exact friend counts are
certified.

The real-backend check passed 43 of 43 checks. It created three users. It covered
search, friendship, visibility, block, mute, groups, link preview, uploads,
albums, signed media, reactions, comments, notifications, messages, saved-post
privacy, deletion, and billing-plan behavior.

The upload proof bound a generated URL to one user, media kind, and declared
byte size. The signed-media proof checked the exact bytes, hardened response
headers, bounded cache lifetime, a valid byte range, and an unsatisfied-range
rejection. Signed media expires in at most one hour. The 19 MB video cap stays
below the current 20 MiB HTTP-action response limit.

The final primary `/ready` response reported these healthy states:

- database.
- scheduler maintenance and all four required storage and retention loops.
- configuration.
- durable delivery.
- account erasure.
- required migration.

It reported zero dead deliveries, zero overdue deliveries, and zero stale
account-erasure jobs. `staleMaintenanceJobs` was empty.

## Browser proof

The local browser check passed 36 of 36 checks against the real backend. It
covered signup labels, authentication, feed writes, saved posts, and persistent
navigation. It also covered focus, reactions, comments, theme, search,
friendship, notifications, messages, settings, and reactive identity updates.

The first run found a real defect: the friend page tried to run two paginated
queries in one Convex function. The final model materializes two adjacency rows
for each accepted friendship and reads one paginated index. The full browser
check then passed. It also verified the 390 px mobile navigation and overflow
contract and the desktop sticky rail. The temporary Vite server was stopped.

## Native clients

Expo Doctor passed 21 of 21 checks. The reviewed mobile dependency audit passed.
Metro exported one 1.5 MB Hermes bundle for iOS and one 1.5 MB Hermes bundle for
Android with an HTTPS production origin.

The Tauri production build used a generated exact-origin CSP. The source config
does not allow arbitrary external HTTPS or secure WebSocket connections. Signed
desktop installers and App Store or Play Store artifacts remain external gates.

## Synthetic load smoke

The final local launch-profile smoke used 50 HTTP workers for 10.070 seconds, no
worker interval, and 10% writes.

| Measure | Result |
| --- | ---: |
| Requests | 6,353 |
| Reads | 5,714 |
| Writes | 639 |
| Errors | 0 |
| Error rate | 0% |
| Request rate | 630.88/s |
| Overall p50 | 77 ms |
| Overall p95 | 110 ms |
| Overall p99 | 136 ms |
| Read p95 | 110 ms |
| Write p95 | 114 ms |

The final local scale-threshold smoke used the same 50 workers for 10.057
seconds.

| Measure | Result |
| --- | ---: |
| Requests | 6,593 |
| Reads | 5,934 |
| Writes | 659 |
| Errors | 0 |
| Error rate | 0% |
| Request rate | 655.58/s |
| Overall p50 | 76 ms |
| Overall p95 | 98 ms |
| Overall p99 | 124 ms |
| Read p95 | 97 ms |
| Write p95 | 102 ms |

Both final smokes passed their latency and error checks. Both set
`certified: false` and `certification_scope: synthetic_http`. They did not use
the required 1,000 or 5,000 workers or the required 15- or 60-minute duration.
The scale run also did not meet its 2,500 request/s target. Neither run measured
realtime connected sessions.

An earlier 50-worker scale smoke made 3,351 requests with zero errors. Its read
p95 was 398 ms and failed the 300 ms threshold. Its write p95 was 456 ms and
passed. The host was under heavy compile load. This failed result remains part
of the evidence. The later run passed while the host still reported load
averages of 9.04, 6.93, and 5.85. An unrelated Go compiler used 83% CPU.
Local reruns do not replace hosted certification.

The load generator and application verification made zero AI provider calls and
used zero AI tokens. This value covers the product runtime. It does not meter
the authoring agent for this repository work.

## Backup and recovery

The final scripted local export produced this verified snapshot:

- SHA-256:
  `f5cd951c97bb115f27d0e8736fb058d8c8272d7a884a81bce6f978b3662e4b66`
- ZIP size: 129,898 bytes.
- Uncompressed size: 380,113 bytes.
- ZIP entries: 111.
- Required tables: 46.
- Stored files: 16.
- Missing required tables: 0.

The restore script imported 1,554 documents and all 16 files into a new
disposable backend. It compiled the final functions and confirmed the required
migration. It dispatched durable work and ran all storage and retention loops.
It wrote a scheduler heartbeat, read the telemetry summary, and passed `/ready`. The
complete export and restore command took 25 seconds. The script removed the
disposable backend and restored `.env.local` to the primary backend.

This proof used synthetic local data. It proves compatibility with the pinned
local Convex image. It does not prove hosted provider recovery or the selected
recovery time objective.

## Documentation review

The advisory Simple English checker found no banned modal, contraction, hidden
`-ing` clause, Latin abbreviation, complex tense, semicolon, or slop word in the
production corpus. The launch checklist had zero mechanical finding. A manual
review split each real prose sentence that exceeded its mode limit. Remaining
advisory counts came from Markdown tables and intentional technical terms.

## External gates

Repository work cannot complete these gates:

- production Clerk instance, custom Frontend API domain, live authentication,
  MFA, recovery, and account-erasure proof.
- Cloudflare Pages project, custom domain, DNS, TLS, rendered live CSP, and live
  probe.
- Convex production plan, current provider session-limit evidence, log stream,
  alerts, and cost controls.
- verified Resend sender and explicit live Stripe and Web Push decisions.
- scheduled off-provider backups and measured hosted recovery time.
- full hosted synthetic HTTP certification and separate realtime session soak.
- code signing, notarization, native store submission, and update channels.
- legal, privacy, abuse, moderation, on-call, and public-registration approval.
- explicit authority to deploy and launch.

Use `docs/production/launch-checklist.md` to collect those receipts for one
exact clean release.
