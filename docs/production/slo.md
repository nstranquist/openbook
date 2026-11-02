# Service objectives and capacity targets

## Scope

These objectives apply only after a hosted environment passes the launch
checklist. Local tests do not establish an uptime objective. The public status
page must not claim an SLA.

The machine-readable values are in
[`production/scale-targets.json`](../../production/scale-targets.json). Test and
review each change to that file. If the data shape changes, change the schema
with SemVer.

## Profiles

| Measure | Launch | Scale |
| --- | ---: | ---: |
| Planned concurrent sessions | 1,000 | 50,000 |
| Required verified provider session limit | 10,000 | 100,000 |
| Synthetic HTTP workers | 1,000 | 5,000 |
| Minimum HTTP request rate | 500/s | 2,500/s |
| Read p95 | 500 ms | 300 ms |
| Write p95 | 750 ms | 500 ms |
| Maximum error rate | 1.0% | 0.5% |
| Availability objective | 99.5% | 99.9% |
| Minimum synthetic test | 15 minutes | 60 minutes |
| Maximum verified backup age | 26 hours | 2 hours |
| Recovery time objective | 240 minutes | 60 minutes |

The Convex class names in the contract are capacity labels. Before each hosted
test, attach current provider documentation or a provider support receipt that
proves the selected plan meets the required session limit. Provider limits can
change.

## Indicators

Measure these indicators at the service boundary:

- Availability: valid application requests that do not produce a server error
  or timeout, divided by all valid application requests.
- Read latency: end-to-end time for successful representative query requests.
- Write latency: end-to-end time for successful representative mutation
  requests.
- Readiness: percentage of one-minute samples where `/ready` returns HTTP 200
  and `ok: true`.
- Delivery health: age and count of `pending`, `processing`, and `dead` durable
  jobs.
- Client failures: rate of deduplicated browser error fingerprints by release.

Exclude operator load probes, invalid client input, blocked abuse, and provider
maintenance that the service contract explicitly excludes. Do not exclude a
dependency failure merely because another company operates that dependency.

## Error budget

Use a rolling 30-day window:

| Profile | Monthly availability budget |
| --- | ---: |
| Launch, 99.5% | 216 minutes |
| Scale, 99.9% | 43.2 minutes |

If half of the monthly budget is consumed, stop non-reliability releases.
If the full budget is consumed, freeze all releases except incident fixes.
Resume normal releases after the rolling window recovers and the incident
review has an owner.

## Alerts

Page the on-call operator for these conditions:

- `/ready` fails for 5 consecutive minutes.
- Server error rate is above 2% for 5 minutes.
- Read or write p95 is above twice the active profile target for 10 minutes.
- A durable delivery job is dead or more than 15 minutes overdue.
- A required migration is not complete after a deployment deadline.
- An account erasure job has not progressed for 20 minutes.
- No scheduler heartbeat exists for 10 minutes.
- A required storage or retention loop has no successful run for 30 minutes.
- The backup job has no verified snapshot within 26 hours.

Create a ticket, but do not page, for a new client-error fingerprint unless its
rate affects the server error or readiness threshold.

## Scale certification

Scale certification needs all of this evidence from the same release and
production-like environment:

1. `openbookctl load --certify` passes the selected profile.
2. The receipt states `certification_scope: synthetic_http`.
3. A separate realtime session soak reaches the planned session target without
   exceeding the latency, error, CPU, memory, and provider quota limits.
4. The provider session limit and selected plan are recorded with a date.
5. `/ready`, log streaming, and alerts stay healthy for the full test.
6. The test data is synthetic and the operator approves external load.

The load tool requires `--confirm-production-load` for a non-loopback target.
This flag confirms load authorization. It does not grant deployment authority.
