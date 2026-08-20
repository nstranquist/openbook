# KEP-002 — Native clients

- Status: accepted, web PWA shipped; store binaries not started
- Date: 2026-08-20

## Decision

The installable client in this repository is the **web PWA** (`apps/web`):
manifest, service worker, standalone display. iOS/Android home-screen
install uses that PWA. A local desktop window is
`scripts/open-desktop.sh` (Chrome/Edge app mode).

Expo and Tauri remain a later extract. They must consume
`@openbook/shared` + the Convex API and must not reintroduce
`dev:mobile` / `dev:desktop` scripts that point at missing packages.

## Why not Expo/Tauri in this slice

Store binaries need signing, icons, and a review path. A second React
Native tree would duplicate the product without a recruiter walkthrough
that needs it. The PWA is a real client: same origin, same auth, same
schema.

## Acceptance (PWA — current)

- `manifest.webmanifest` + `sw.js` are served from `apps/web/public`.
- `index.html` declares standalone display and theme color.
- `scripts/open-desktop.sh` opens the running web app in app mode.

## Acceptance (store — future)

- One shared `@openbook/shared` contract.
- No unpublished `@nicos` packages.
- Publication gate includes the new app.
