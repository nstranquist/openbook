# Openbook — agent notes

- Package manager: **pnpm** (frozen lockfile in CI).
- Verification: `pnpm verify:publication` / `make publish-ready` (local only; no push).
- Tests: `pnpm test` (vitest + convex-test). Do not invent browser E2E unless
  `scripts/verify-live.mjs` is already in scope. Visibility must apply to
  comments and reactions, not only the feed.
- Never commit `.env.local` or Convex deploy keys.
- Comparative Facebook/Meta branding is forbidden in product copy.
- Brand mark: `assets/brand/openbook.svg` (+ `apps/web/public/` for runtime favicon/logo).
  Prefer `BrandMark` over letter marks; no Meta-like blue "b".
- Honesty: canonical UI is **web + PWA**. `apps/desktop` (Tauri) and
  `apps/mobile` (Expo) are native shells over that UI. Store signing and a
  hosted public userbase stay operator-gated (KEP-002 / KEP-003).
- Publication export: `pnpm export:publication -- --out <empty-dir>` only.
- Job-search shortlist rank: **P1 #1** after docs-puller
  (`nicos-tools/docs/active/07-20-1800-job-search-oss-shortlist/`).
