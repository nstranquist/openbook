# Backend — Convex Realtime

This `convex/` directory is the **single backend** every platform syncs against.

- `schema.ts` — the document schema (auth tables + the `notes` demo collection).
- `auth.ts` / `auth.config.ts` / `http.ts` — Convex Auth: one identity shared by web, mobile, and desktop.
- `notes.ts` — reactive `query`/`mutation` functions. `list` is a live subscription: every client re-renders the moment any platform writes.

`_generated/` (the typed API + data model) is created by `npx convex dev` and is
gitignored. `@openbook/shared` re-exports it so the apps never reach across
the repo for it.

Run `npx convex dev` from the repo root to provision a deployment and start the
backend in watch mode.
