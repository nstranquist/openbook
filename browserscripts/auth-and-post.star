# Full signup -> post -> verify flow, ported from openbook's scripts/verify-ui.mjs
# (which hand-rolls the SAME flow via ~40 raw `ndev browser exec` + JS-string calls).
# This is the declarative/Starlark equivalent: built-in steps, assertions, audit.
#
# REQUIRES the Convex backend deployed (functions pushed + auth set up), then the
# web restarted pointed at it:
#   CONVEX_PORT=3210 pnpm selfhost
#   (cd apps/web && env VITE_CONVEX_URL=http://127.0.0.1:3210 pnpm exec vite --port 5179)
# Run (mutating verbs -> needs --allow-drive):
#   ndev browser open ob
#   ndev browser script run browserscripts/auth-and-post.star --session ob \
#     --allow-drive --var base=http://localhost:5179/ --var name=AdaTest
base = params["base"]
name = params.get("name", "PlaybookUser")
email = name.lower() + "@openbook.local"

# Text-labeled buttons use the native `click_text` builtin: a REAL CDP click on a
# button/link/role=button matched by visible text (drive-gated, like click()).

nav(base)
wait("body")
console(reload=True, window="2000ms", kind="js", fail_on_error=True)   # bundle must not crash on load

# Fresh start: a prior run may have left THIS session authenticated (.ob-nav only
# renders when logged in). Log out so the signup form is reachable.
if "true" in eval("!!document.querySelector('.ob-nav')"):
    click('.ob-iconbtn[aria-label="Account menu"]')
    click_text("Log out")
    wait('input[placeholder="Email"]')

# --- Signup (Convex Auth password provider) ---
click_text("Create new account")
fill('input[placeholder="Full name"]', name)
fill('input[placeholder="Email"]', email)
fill('input[placeholder="Password"]', "hunter2-playbook")
click_text("Sign up")
wait(".ob-nav")                        # reaching the feed proves auth worked
emit({"step": "signed-up", "as": name})

# --- Create a post (backend write -> reactive read) ---
# Tie the body to the unique user so we assert OUR post, not a leftover; and
# assert feed-wide (not just the first card) since other users' posts interleave.
post_body = "browserscript playbook by " + name
click(".ob-composer-open")
fill(".ob-textarea", post_body)
click_text("Post")
wait_text(post_body)        # wait for OUR post to round-trip the reactive query (not just any card)
emit({"step": "posted+verified", "body": post_body})
