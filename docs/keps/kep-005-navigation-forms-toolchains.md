# KEP-005 — Complete navigation, forms, and toolchain work

- Status: implemented and verified
- Date: 2026-08-20
- Product: Openbook (`~/tools/openbook`)

## Problem

The feature backlog was complete, but the product shell was not complete.
The desktop navigation did not stay outside route transitions. Small screens
could overflow the fixed header. Saved posts and full notification history
did not have product routes. Some forms had visual text without a complete
form contract. The web and native toolchains also needed a current review.

## Decision

- Keep the desktop rail mounted outside the route switch.
- Use a six-item bottom navigation on screens at or below 860 pixels.
- Add private Saved and paginated Notifications routes.
- Use named forms, programmatic labels, submit behavior, route focus, and a
  skip link.
- Upgrade the web stack, Expo, React Native, and Tauri to current supported
  families. Hold same-day Vite releases until they have a maturity window.
- Pin CI actions to immutable release commits. Let Dependabot propose updates.
- Keep Expo's supported Metro versions. Permit only the two reviewed,
  build-time `image-size` advisories through a fail-closed Go gate. Expire the
  exception on 2026-09-20.

## Acceptance evidence

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- The unit suite passes 66 tests.
- The live backend script passes 35 checks.
- The browser script passes the desktop, mobile, multi-user, Saved,
  notifications, focus, and form contracts.
- Expo Doctor passes 21 checks. iOS and Android exports complete.
- The mobile audit rejects a new advisory, path change, version change, or
  expired exception.
- Tauri `cargo check --locked` and the desktop npm audit pass.
- The full publication boundary passes before publication.

## External gates

This KEP does not claim store publication or a hosted userbase. KEP-002 and
KEP-003 remain human-operated release gates.
