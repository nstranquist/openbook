# KEP-002 — Native clients

- Status: accepted, PWA + Tauri shell + Expo shell shipped; store signing not started
- Date: 2026-08-20

## Decision

The installable client in this repository is the **web PWA** (`apps/web`):
manifest, service worker, standalone display. iOS/Android home-screen
install uses that PWA. A local desktop window is
`scripts/open-desktop.sh` (Chrome/Edge app mode).

`apps/desktop` is a Tauri 2 window over `apps/web`.
`apps/mobile` is an Expo WebView over the same origin.
Both consume the Convex API through the web client. They must not
reintroduce `dev:mobile` / `dev:desktop` scripts that point at missing
packages. Store signing remains operator-gated.

## Why not Expo/Tauri in this slice

Store binaries need signing, icons, and a review path. A second React
Native tree would duplicate the product without a recruiter walkthrough
that needs it. The PWA is a real client: same origin, same auth, same
schema.

## Acceptance (PWA — current)

- `manifest.webmanifest` + `sw.js` are served from `apps/web/public`.
- `index.html` declares standalone display and theme color.
- `scripts/open-desktop.sh` opens the running web app in app mode.
- Service worker handles `push` / `notificationclick`. Settings can
  subscribe when `VAPID_PUBLIC_KEY` is set.

## Acceptance (store — future)

- One shared `@openbook/shared` contract.
- No unpublished `@nicos` packages.
- Publication gate includes the new app.
