# Openbook backlog

KEP-001 shipped the in-repo social completeness slice. Remaining work is
store binaries and a hosted public userbase (KEP-002, KEP-003).

## Shipped in-repo (2026-08-20)

Email verify when Resend is set. Password change while signed in.
Stripe cancel + session/refresh wipe on close. Upload occupancy + hourly
GC. Client EXIF strip. Mute. Profile bio/friends-list privacy. Reports
with operator review. Comment pagination. Message edit/hide + last-read
+ message search. Pair occupancy locks. Stories (24h). Groups/pages with
member-only posts. Events + RSVP. Post full-text search. Video on posts.
Email notify when Resend is set. PWA install. `/status` + `/health`.
Desktop app-mode script. Backup script.

## Still out

| Item | Home |
| --- | --- |
| Expo / Tauri store binaries | KEP-002 |
| Hosted production userbase | KEP-003 |
| Dedicated image CDN | later |
| Web-push send (subscriptions are stored) | polish |

## Non-goals

Meta branding. Claiming a public hosted Openbook service from this repo
until KEP-003 is executed by a human.
