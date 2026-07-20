# browserscripts — repeatable UI tests via `ndev browser script`

These are [`ndev browser script`](https://github.com/nicos-tools) playbooks: a
recorded/authored sequence of browser verbs run as ONE unit against an open
session, streaming a per-step JSON verdict (immediate feedback) and auditing the
run to `events.jsonl` + a manifest under `~/.nicos-dev/browser/scripts/`.

This is the productized version of what `scripts/verify-ui.mjs` already does by
hand: ~200 lines of Node shelling out to `ndev browser exec … eval/click/press`
with hand-rolled JS helpers (`clickText`, `bodyHas`, `exists`, `poll`, `sleep`).
A playbook expresses the same flow with built-in steps, assertions, captures,
a console-error gate, and an audit trail — no glue script.

## Files

| File | What | Backend needed? |
|---|---|---|
| `home-smoke.yaml` | Declarative shell-health: load → assert title → screenshot | No |
| `smoke.star` | Shell-health + **console-JS-error gate** + title check (parameterized) | No |
| `auth-and-post.star` | Full signup → post → verify (port of `verify-ui.mjs`'s core) | **Yes** |

## Run

```sh
# 0. start the web app (Vite on :5179 here; :5173 is taken by nvault locally)
ndev dev run --name openbook-web --cwd apps/web \
  --cmd "env VITE_CONVEX_URL=http://127.0.0.1:3210 pnpm exec vite --port 5179" --port 5179

# 1. open ONE browser session (the playbooks drive an already-open session)
ndev browser open ob

# 2a. shell-health smoke (no backend) — passes if the bundle loads without JS crash
ndev browser script run browserscripts/smoke.star --session ob \
  --var base=http://localhost:5179/ --var expect=Openbook

# 2b. declarative variant
ndev browser script run browserscripts/home-smoke.yaml --session ob

# 3. full auth+post flow — MUTATING, so --allow-drive. Needs the backend deployed:
CONVEX_PORT=3210 pnpm selfhost     # Docker OSS Convex + functions + auth keys
ndev browser script run browserscripts/auth-and-post.star --session ob \
  --allow-drive --var base=http://localhost:5179/ --var name=AdaTest

ndev browser script list           # recent runs + outcomes
```

stdout is one JSON line per step (+ `{"emit":…}` rows). Exit code is 0 only if
every step passed. The durable manifest redacts captured values and assertion
"actual" values (secret-named keys → `[redacted]`, URL query/fragment stripped).

## The pattern (applies to any web app in ~/tools)

- **Verbs**: `navigate click type press wait text eval fetch console screenshot
  assert_text assert_url`. Starlark built-ins: `nav click fill press wait text
  eval fetch console screenshot assert_text assert_url emit` + `params["k"]`.
- **Parameterize** with `--var k=v` so one playbook tests dev/preview/prod:
  `--var base=https://…`.
- **Console-error gate**: `console(reload=True, kind="js", fail_on_error=True)`
  fails the run if the page's own JS throws on load — the "did the bundle crash"
  check. (It diagnosed openbook's missing `VITE_CONVEX_URL` as a `ZodError`.)
- **Drive-gating**: `click/type(fill)/press` are refused unless you pass
  `--allow-drive` — read-only smokes can't accidentally mutate.
- **Assertions** make a playbook self-verifying: `assert_text(sel, contains=…)`,
  `assert_url(contains=…)`, or an `assert:` block on any `text`/`eval`/`fetch`
  step. In Starlark, branch on real page state and `fail("…")` to abort.

To test another app (e.g. `~/tools/trello-duo`, `~/tools/architecture-agent`):
copy `smoke.star`, point `--var base=` at its URL, and add app-specific
`assert_text`/selectors.

## Gotchas learned bringing this up

- `:5173` collides — nvault runs there locally; openbook's Vite is `strictPort`,
  so start it on another port (`--port 5179`).
- `ndev dev run` execs directly (no shell): pass env via `env VAR=val …`, not
  inline `VAR=val …`.
- `navigate` returning `ok` ≠ the page loaded — a refused connection renders
  Chrome's error page. Always `assert` on content, not just navigation.
- `eval(...)` returns the result JSON-encoded (so a string comes back quoted);
  `text(...)` returns raw text.

## click_text / wait_text (native, text-targeting)

Text-labeled elements are first-class — no CSS-selector gymnastics:

- `click_text("Sign up")` — REAL CDP click on the first
  `button`/`a`/`role=button`/submit-input matching that visible text
  (case-sensitive substring). Drive-gated like `click`.
- `wait_text("…")` — read-only wait until an element whose text contains the
  string is visible. The correct primitive for **reactive content**: after
  posting, `wait_text(post_body)` waits for *your* post to round-trip Convex's
  reactive query, instead of `wait("article.ob-card")` matching a stale card.

Both replaced the earlier `eval(...).click()` / hand-rolled poll workarounds.
`auth-and-post.star` also logs out first if the session is already
authenticated (a prior run leaves it logged in), so it's idempotent.

### Locator cheat-sheet (Playwright → browserscript)

| Playwright | browserscript |
|---|---|
| `getByText` | `click_text("Sign up")` / `wait_text("…")` |
| `getByTestId` | `click('[data-testid="x"]')` (CSS) |
| `getByRole` | `click('[role="button"]')` (CSS) |
| `getByPlaceholder` | `fill('[placeholder="Email"]', …)` (CSS) |
| `getByLabel` (aria) | `click('[aria-label="Account menu"]')` (CSS) |
| structural / positional | `click_xpath('//div[.//span[text()="Babbage"]]//button')` |

Most locators are plain CSS attribute selectors; `*_text` matches visible text;
`*_xpath` handles structural queries CSS can't express. `wait_text`/`wait_xpath`
are read-only. Per-step `timeout:` can extend a wait past the 30s default for
slow reactive content (e.g. `wait_text: …` with `timeout: 60s`).
