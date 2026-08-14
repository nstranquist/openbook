# Openbook: realtime social systems with server-enforced trust boundaries

## Problem

A useful social application is more than a feed mockup. Identity, friend-graph
state, audience visibility, denormalized reactions, notifications, messaging,
and unread counts must remain correct while updates arrive in realtime.

## Nico's role

Nico designed and implemented the application across the Convex schema and
functions, shared typed contracts, React client, authentication, billing spine,
test harness, live verification scripts, and independently buildable UI layer.

## Key decisions

- Enforce public-versus-friends visibility on the server rather than filtering
  private posts only in the browser.
- Keep reaction tallies transactionally consistent with one reaction row per
  user and post.
- Model notifications and message unread state as realtime backend data so
  every client observes the same truth.
- Share API/schema types across the backend and React client.
- Preserve a clean publication boundary by vendoring only Nico-owned design
  assets and removing dependencies on unpublished local packages.

## Verified result

The application implements profiles, friend requests and suggestions, an
audience-scoped paginated feed, six reactions, comments, notifications,
realtime direct messages, unread accounting, and indexed people search. Local
publication verification passes both Go publication-tool suites, TypeScript
checks, 28 Convex tests, a production build, dependency-license review, and
both secret-scan modes.
Public GitHub Actions CI on `main` runs the same publication gate.

## Evidence boundary

Openbook is public at
[`nstranquist/openbook`](https://github.com/nstranquist/openbook) under MIT.
This write-up does not claim a hosted production deployment or a user dataset.
