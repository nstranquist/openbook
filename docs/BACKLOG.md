# Openbook backlog

Living roadmap of what this repo **does not** claim yet. Update when a
slice ships. Do not mark a row done without a test or live check.

Target: a senior-defensible realtime social product, not a Meta clone.

## Now (next build slices)

1. **Email verification on sign-up** — Password `verify` provider; unsigned-up
   sessions cannot post until the code lands.
2. **Cancel Stripe on account close** — `deleteAccount` currently drops the
   local mirror and ignores sessions at Stripe; call the Billing API then
   invalidate refresh tokens as well as `authSessions`.
3. **Orphan upload GC** — unused `uploads` rows and storage blobs after
   Cancel/Escape; a cron or mutation timeout.
4. **Refresh-token wipe on close** — `authRefreshTokens` still exist after
   `authSessions` delete.
5. **Live E2E for block / image / reset** — extend `scripts/verify-live.mjs`.
6. **CI evidence for images** — convex-test cannot mint storage ids today;
   add a selfhost check that upload + visibility holds.

## Next (product completeness)

7. **Password change while signed in** (Settings), not only forgot-password.
8. **Message edit** and conversation hide/delete for one participant.
9. **Comment pagination** (today `collect()` on the thread).
10. **Read receipts** that are actually per-message, if we ever claim them.
11. **Reports / safety queue** (report post or user, operator review).
12. **Mute** (hide without blocking friendship).
13. **Profile privacy** (friends-only bio, hide friend list).
14. **Unique pair documents** — occupancy row or deterministic id so
    collapse is a backstop, not the primary invariant.

## Later (only if we still want a “full” social app)

15. Albums, stories, groups, pages, events.
16. Video / multi-image posts; image CDN and EXIF strip.
17. Push / email notification delivery (not only in-app bell).
18. Search that is not just display-name FTS (posts, messages).
19. Mobile / desktop clients (explicitly out of this repo today).
20. Hosted production deployment and a real user dataset.

## Explicit non-goals

- Meta/Facebook branding, assets, or comparative copy.
- Claiming a public hosted Openbook service.
- Treating a green unit suite as production load proof.
