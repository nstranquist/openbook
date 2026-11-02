# Changelog

All notable changes to Openbook are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned as **0.2.0**. The release is held until `main` CI is green (see
"Known issues" below); the version fields still read 0.1.0 until then.

### Added

- **Accounts and auth:** GitHub and Google OAuth on the landing card; password
  reset by emailed code (Resend, when `RESEND_API_KEY` is set); account close
  from Settings; a pluggable web auth provider (local Convex Auth or Clerk) and
  production external-identity mapping in the backend.
- **Social features:** block (hides posts and stops new friend/DM writes both
  ways), mutes, reports, post editing, comment editing, post images in Convex
  storage, saved posts, stories, groups, events, link previews for the first
  public URL in a post, presence (last seen), typing indicators, and profile
  photo albums with uploads from the album tab.
- **Messaging and notifications:** message search, sender message delete, web
  push notifications (service worker, VAPID key script), and a notifications
  page whose items open the related post.
- **Web app:** billing plan panel in Settings, post permalinks, left
  navigation, completed navigation and forms, responsive layouts, PWA manifest,
  status page, security headers, and SPA redirects for static hosting.
- **Native shells:** a Tauri desktop shell and an Expo mobile shell over the web
  app, launched from `make`, with signed media URLs; later wired to production
  auth and telemetry.
- **Backend for production:** a delivery worker for outbound email and push,
  client telemetry ingestion, data migrations, health probes, pagination and
  request-body limits, and garbage collection jobs.
- **Operations tooling:** `openbookctl` (`targets`, `audit`, `readiness`,
  `probe`, `load`, `backup`, `desktop-config`), web/desktop deploy scripts, a
  backup export script, a restore drill, and `production/scale-targets.json`.
- **Docs:** SECURITY.md, README usage, screenshots gallery, public product
  passport, backlog and KEPs 001–006, and production docs
  (architecture, runbook, SLOs, disaster recovery, security and privacy, launch
  checklist) with local production-scale evidence.
- **CI:** Dependabot config, a mobile job (Expo doctor, production dependency
  audit, iOS/Android export), a desktop job (Tauri check and build), and a
  self-hosted Convex backend integration job.

### Changed

- Supported toolchains updated: Node 24 in CI, Expo SDK 57, refreshed web and
  desktop dependencies.
- Remember-me now stores the email only; previously saved passwords are
  stripped on load.

### Fixed

- Hidden posts no longer leak through comment and reaction APIs or feed fill.
- Checkout return URLs are origin-allowlisted (loopback only for a local
  `SITE_URL`).
- Duplicate conversation and friendship rows collapse onto the live row.
- Closed accounts cannot write; uploaded images must belong to the uploader;
  password reset no longer reveals whether an email exists.
- Long-press opens the reaction picker without also liking the post; empty
  scan pages stay on the skeleton.
- Self-hosted Convex scripts pull from `ghcr.io/convex/convex-backend` (the old
  `ghcr.io/get-convex` namespace now denies anonymous pulls; same pinned
  digest) and use `grep` instead of `rg` so they run on stock CI runners.

### Security

- Dependency floors for high/critical advisories: vite 8.2.4, zod 4.6.6,
  concurrently 10.0.6, and pnpm overrides for undici ≥7.30.1, sharp ≥0.35.5,
  source-map-js ≥1.2.2, and shell-quote ≥1.12.0 (also overridden in the Expo
  app). Expo SDK 57 patch versions aligned (expo 57.0.31, expo-asset 57.0.20,
  react-native 0.86.3).

### Known issues

- The mobile production dependency audit (`tools/mobile-audit`) fails: its
  reviewed `image-size` exception expired on 2026-09-20, and the Expo SDK 57
  graph now carries other advisories (`deepmerge`, which has no fixed
  release, plus `glob`, `minimatch`, and zod 3 inside `@expo/cli`) that only a
  move to Expo SDK 58 clears.

## [0.1.0] - 2026-07-25

- First tagged release.

[Unreleased]: https://github.com/nstranquist/openbook/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nstranquist/openbook/releases/tag/v0.1.0
