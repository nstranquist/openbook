# Disaster recovery

## Objectives

| Profile | Maximum verified backup age | Recovery time objective |
| --- | ---: | ---: |
| Launch | 26 hours | 240 minutes |
| Scale | 2 hours | 60 minutes |

The launch profile requires a verified daily or hourly backup. The scale
profile requires a verified hourly backup. These are recovery objectives, not
a claim that a provider backup exists. Test the scheduled process and alert.
Then set `OPENBOOK_BACKUP_POLICY`.

The objectives cover application data and Convex file storage. Provider state
in Clerk, Stripe, Resend, Cloudflare, and Web Push needs separate provider
configuration records. Do not put their secrets in a Convex snapshot.

## Backup procedure

Use a private destination outside the repository. The path must be absolute and
unused. For production, the operator must confirm the export:

```text
OPENBOOK_BACKUP_TARGET=production \
OPENBOOK_BACKUP_PROD=I_UNDERSTAND \
bash scripts/export-backup.sh /absolute/private/path/openbook-YYYYMMDDTHHMMSSZ.zip
```

The script includes file storage and verifies ZIP structure and CRC values. It
checks the required table set. It computes SHA-256 and writes a private JSON
manifest. Transfer the ZIP and manifest to encrypted storage in a different
failure domain. Limit access, enable object versioning or immutability, and
apply the approved retention policy.

If the verified backup is older than the profile maximum, alert the operator.
An export command returning zero is not enough. The verification and
off-provider transfer must also succeed.

## Restore drill

The drill imports one verified snapshot into a new disposable local Convex
backend. It must never replace a production or shared development deployment.

```text
OPENBOOK_RESTORE_DRILL=I_UNDERSTAND \
bash scripts/restore-drill.sh /absolute/private/path/openbook-snapshot.zip
```

The script refuses an existing target container. It verifies the backup and
uses a pinned Convex backend image. It imports all tables and file storage. It
runs the required migration, dispatches durable work, and runs every storage
and retention loop. It writes a scheduler heartbeat, reads client telemetry,
and requires `/ready` to pass. It restores the prior local environment file. It
removes the disposable backend at exit.

For each quarterly drill, also perform these checks:

1. Sign in with a synthetic account in the isolated environment.
2. Read representative public, friends-only, group, event, album, and message
   data.
3. Open restored media.
4. Perform one write and verify realtime delivery to a second client.
5. Confirm exact badge and content counts.
6. Confirm that a synthetic account erasure completes.
7. Record snapshot time, SHA-256, table and file counts, start time, ready time,
   selected profile, release, operator, and result.

Do not retain the restored environment after the drill. Do not use live user
credentials during a local drill.

## Production recovery decision

If data or deployment state cannot be repaired safely in place, use recovery.
Before import, stop writes or place the service in a controlled maintenance
state. Record the incident start, last known-good backup, expected data-loss
window, and approval.

Convex imports can replace deployment data. A production import is destructive
and is not automated by this repository. Use the current official Convex import
procedure, a newly verified snapshot, two-person review, and an explicit
provider-side confirmation. Never infer production import authority from the
local drill confirmation.

After recovery:

1. Deploy the matching or a schema-compatible application revision.
2. Run required migrations to completion.
3. Write a scheduler heartbeat, dispatch durable work, and run each required
   storage and retention loop.
4. Require `/ready` to pass.
5. Run authentication, read, write, realtime, media, webhook, and erasure
   checks.
6. Compare provider records that are newer than the snapshot. Reconcile Stripe
   by signed webhook replay or a reviewed provider query. Do not invent billing
   state.
7. Open traffic gradually and monitor the active SLO.

## Evidence boundary

A successful local restore proves import compatibility with the pinned local
Convex backend. It also proves that the restored Openbook instance becomes
ready. It does not prove provider recovery, production permissions, production
import time, or the hosted recovery objective. Measure and save those values in
the target environment before scale certification.
