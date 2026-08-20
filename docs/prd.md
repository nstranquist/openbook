# Openbook product requirements

Date: 2026-08-20
Status: current

Openbook is a realtime social product on one Convex backend and one web
client. The web client is also the installable PWA. Native store binaries
and a hosted public userbase stay operator-gated (KEP-002, KEP-003).

## Who it is for

A person who wants a small, honest social network they can run locally
or on their own Convex deployment. Showcase quality for a senior
full-stack review, not a Meta clone.

## Jobs to be done

1. Sign up, verify email when mail is configured, and keep a profile.
2. Post text, a photo, or a video to public or friends, including in a group.
3. Find people, become friends, mute, block, and report.
4. Comment, react, and get notified in-app and by email when mail is set.
5. Message friends with edit, hide, and last-read receipts.
6. Share a 24-hour story, create a group or page, and RSVP to an event.
7. Close the account and have sessions, files, and Stripe follow.

## In scope now

Server-enforced visibility, pair occupancy, mute vs block, reports with
an operator queue, paginated comments, searchable posts and messages,
owned uploads with EXIF strip on the client, hourly GC, password change
while signed in, PWA install, a public status page, and a backup script.

## Out of scope

Facebook/Meta branding. App Store / Play binaries. Claiming a public
hosted Openbook service. Treating the unit suite as load proof.

## Acceptance

`pnpm test` and `pnpm typecheck` are green. `scripts/verify-live.mjs`
covers block, comments pagination, mute, groups, and image upload
against a live backend. `docs/BACKLOG.md` lists only what is still out.
