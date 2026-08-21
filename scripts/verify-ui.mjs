#!/usr/bin/env node
// verify-ui.mjs — UI-level proof that openbook's controls work against the REAL Convex
// backend, dogfooding `ndev browser`. Complements the Convex-level verify-live.mjs.
// Template: apps/linear-clone/scripts/verify-ui.mjs (garrid full-clones program).
//
// Drives the PRIMARY user (A) entirely through the browser, and uses a ConvexHttpClient
// "user B" (mirroring verify-live.mjs's multi-user wiring) to exercise the two-sided
// flows — friend request, DM delivery, reaction/comment notifications — then asserts the
// PERSISTED backend effect on BOTH sides (DOM round-trip + cross-user query).
//
// Run with the app + self-hosted backend up:
//   node scripts/verify-ui.mjs                          # URL :5176, backend :3230
//   URL=http://localhost:5176/ CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3230 node scripts/verify-ui.mjs
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const NDEV = process.env.NDEV || "ndev";
const URL = process.env.URL || "http://localhost:5176/";
const S = process.env.SESSION || "ob-verify";
// The web app on :5176 is started with VITE_CONVEX_URL=http://127.0.0.1:3230 — the helper
// user must hit the SAME backend so its writes show up in A's browser.
const BACKEND =
  process.env.CONVEX_SELF_HOSTED_URL || process.env.VITE_CONVEX_URL || "http://127.0.0.1:3230";

const run = (command, args, label) => {
  try {
    // ndev actions have a 30-second actionability budget plus a small cleanup
    // grace period. Keep the process bound above that budget so a failed action
    // can return its typed precondition error instead of being killed as ETIMEDOUT.
    return execFileSync(command, args, { encoding: "utf8", timeout: 40_000 });
  } catch (error) {
    const detail = error?.stderr?.toString().trim().split("\n").at(-1);
    throw new Error(`${detail || (error instanceof Error ? error.message : "command failed")} during: ${label}`);
  }
};
const browser = (...args) => run(NDEV, ["browser", ...args], `ndev browser ${args.slice(0, 4).join(" ")}`);
const ex = (verb, ...args) => browser("exec", S, verb, ...args);
const evalJs = (js) => ex("eval", "", js);
const pause = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
const got = (js) => evalJs(js).trim();
// `eval` prints JSON, so string returns come back double-quoted — unwrap them.
const gotStr = (js) => { const r = got(js); try { const v = JSON.parse(r); return typeof v === "string" ? v : r; } catch { return r; } };
const truthy = (js) => got(js).includes("true");
const exists = (sel) => truthy(`!!document.querySelector(${JSON.stringify(sel)})`);
const bodyHas = (text) => truthy(`document.body.innerText.includes(${JSON.stringify(text)})`);
const clickText = (t) =>
  evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})?.click()`);
const clickHas = (t) =>
  evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(t)}))?.click()`);
const pressEnter = () => ex("press", "Enter");

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? `  — ${d}` : ""}`); } };
// Reactive Convex queries settle async — poll a predicate up to `tries` seconds.
const poll = (fn, tries = 6) => { for (let i = 0; i < tries; i++) { if (fn()) return true; pause(1); } return fn(); };

// --- ConvexHttpClient helper (a second real user, B) -------------------------------
const fn = (name) => makeFunctionReference(name);
async function signUpHttp(name) {
  const client = new ConvexHttpClient(BACKEND);
  const res = await client.action(fn("auth:signIn"), {
    provider: "password",
    params: { email: `${name.toLowerCase()}@openbook.local`, password: `Pw-${name}-aA1!`, flow: "signUp" },
  });
  const token = res?.tokens?.token;
  if (!token) throw new Error(`no auth token for ${name}: ${JSON.stringify(res)}`);
  client.setAuth(token);
  await client.mutation(fn("profiles:ensure"), { displayName: name });
  const me = await client.query(fn("profiles:me"), {});
  return { client, userId: me.userId, displayName: me.displayName };
}

const stamp = Date.now();
const aName = `Averly${stamp}`;          // A's display name — one search-friendly token
const bName = `Helperbot${stamp}`;       // B's display name
const body = `UI verify post ${stamp}`;
const commentText = `verify-comment-${stamp}`;
const dmText = `verify-dm-${stamp}`;

console.log(`\nopenbook UI verification (real Convex backend) → ${URL}  [backend ${BACKEND}]\n`);

(async () => {
  let bUser = null, aUserId = null, postId = null;
  try {
    try { browser("close", S, "--purge-profile"); } catch {} // clear test-only state left by a killed run
    browser("open", S);
    ex("navigate", URL);
    pause(2);
    ex("snapshot", "--role", "button,link", "--max", "80");

    // The session profile persists auth across runs — if a previous run's user is
    // still signed in, log out so A is ALWAYS a fresh, uniquely-named signup.
    if (exists(".ob-nav")) {
      evalJs(`[...document.querySelectorAll('.ob-iconbtn')].find(b=>(b.getAttribute('aria-label')||'')==='Account menu')?.click()`); pause(1);
      clickHas("Log out"); pause(2);
    }

    // --- Signup A (Convex Auth + backend), unique display name ---
    clickText("Create new account"); pause(1);
    check("Signup fields have programmatic labels",
      truthy(`[...document.querySelectorAll('form[aria-label="Sign up"] input[name]')].every(input=>input.labels?.length===1)`));
    if (exists('input[name="name"]')) ex("type", 'input[name="name"]', aName);
    if (exists('input[name="email"]')) ex("type", 'input[name="email"]', `${aName.toLowerCase()}@openbook.local`);
    if (exists('input[name="password"]')) ex("type", 'input[name="password"]', "hunter2-verify");
    clickText("Sign up"); pause(5);
    check("Signup authenticates + reaches the feed", exists(".ob-nav"));
    ex("snapshot", "--role", "button,link", "--max", "80");

    // --- Create a post (backend write → reactive read) ---
    if (exists(".ob-composer-open")) { ex("click", ".ob-composer-open"); pause(1); }
    if (exists(".ob-textarea")) ex("type", ".ob-textarea", body);
    clickText("Post");
    check("Post announces success in the live region", poll(() => exists('.g-toast[role="status"]')));
    check("Post persists + renders in the feed", bodyHas(body), "real backend round-trip");

    // A's own post links to A's profile — the most robust way to learn A's userId.
    const aHref = gotStr(`document.querySelector('article.ob-card a[href^="/profile/"]')?.getAttribute('href')||''`);
    aUserId = aHref.startsWith("/profile/") ? aHref.slice("/profile/".length) : null;

    // --- Saved posts + shell persistence (SPA route; no top-level remount) ---
    evalJs("document.querySelector('.ob-leftnav').dataset.verifyPersistent='yes'");
    evalJs(`(()=>{const card=[...document.querySelectorAll('article.ob-card')].find(card=>card.innerText.includes(${JSON.stringify(body)}));
      [...(card?.querySelectorAll('button')??[])].find(button=>button.textContent.includes('Save'))?.click()})()`);
    check("Save persists on the post",
      poll(() => truthy(`(()=>{const card=[...document.querySelectorAll('article.ob-card')].find(card=>card.innerText.includes(${JSON.stringify(body)}));
        return [...(card?.querySelectorAll('button')??[])].some(button=>button.textContent.includes('Saved') && button.getAttribute('aria-pressed')==='true')})()`)));
    ex("click", 'a.ob-leftnav-item[href="/saved"]');
    check("Saved route renders the private saved post",
      poll(() => bodyHas("Saved posts") && bodyHas(body)));
    check("Left navigation stays mounted across route transitions",
      exists('.ob-leftnav[data-verify-persistent="yes"]'));
    check("Saved navigation state and route focus are correct",
      exists('a.ob-leftnav-item[href="/saved"].active') && gotStr("document.activeElement?.id||''") === "main-content");
    ex("click", 'a.ob-leftnav-item[href="/"]');
    poll(() => bodyHas(body));

    // --- React to own post (reactions.toggle → myReaction persists) ---
    evalJs("document.querySelector('article.ob-card .ob-action')?.click()"); pause(2);
    check("Like reaction toggles on (reactions.toggle persisted)",
      exists("article.ob-card .ob-action.reacted"));

    // --- Comment on own post (comments.add → renders in thread) ---
    evalJs("[...document.querySelectorAll('article.ob-card')][0]?.querySelectorAll('.ob-action')[1]?.click()"); pause(1);
    if (exists('article.ob-card input[aria-label="Write a comment"]')) {
      ex("type", 'article.ob-card input[aria-label="Write a comment"]', commentText);
      pressEnter(); pause(2);
    }
    check("Comment posts + renders (comments.add persisted)",
      truthy(`document.querySelector('article.ob-card')?.innerText.includes(${JSON.stringify(commentText)})`));

    // --- Theme toggle (DS ThemeToggle) ---
    const before = got("document.documentElement.dataset.theme||'light'");
    evalJs("document.querySelector('.g-btn--icon')?.click()"); pause(1);
    check("Theme toggle flips data-theme", before !== got("document.documentElement.dataset.theme||'light'"));

    // --- Multi-user setup: helper user B signs up + befriends A -----------------------
    try {
      bUser = await signUpHttp(bName);
      const hits = await bUser.client.query(fn("profiles:search"), { q: aName });
      const a = hits.find((h) => h.displayName === aName);
      check("Helper user B finds A via people search (full-text index)",
        !!a && (!aUserId || a.userId === aUserId), JSON.stringify(hits.map((h) => h.displayName)));
      aUserId = aUserId || a?.userId || null;
      if (aUserId) await bUser.client.mutation(fn("friends:sendRequest"), { userId: aUserId });
    } catch (e) {
      check("Helper user B signs up + sends friend request", false, (e.message || "").split("\n")[0]);
    }

    // --- Friend-request lifecycle (browser A confirms; persisted both sides) ---
    if (aUserId) {
      ex("click", 'a.ob-leftnav-item[href="/friends"]'); pause(2);
      check("Incoming friend request shows for A", poll(() => bodyHas("Friend Requests") && bodyHas(bName)));
      clickText("Confirm");
      check("After Confirm, B appears in All Friends (friends.accept persisted)",
        poll(() => bodyHas("All Friends (1)") && bodyHas(bName)));
      const bFriends = await bUser.client.query(fn("friends:list"), {});
      check("B's friend list now includes A (cross-user persisted)",
        bFriends.some((f) => f.userId === aUserId));
    }

    // --- Notifications: B reacts + comments on A's post → A marks all read ---
    if (bUser) {
      try {
        const feed = await bUser.client.query(fn("posts:feed"), { paginationOpts: { numItems: 20, cursor: null } });
        postId = feed.page.find((p) => p.body === body)?._id ?? null;
        if (postId) {
          await bUser.client.mutation(fn("reactions:toggle"), { postId, kind: "love" });
          await bUser.client.mutation(fn("comments:add"), { postId, body: "from B" });
        }
      } catch (e) { check("B generates reaction+comment notifications for A", false, (e.message || "").split("\n")[0]); }
    }
    ex("click", 'a.ob-leftnav-item[href="/"]'); pause(2);
    const bellLabel = () => gotStr(`document.querySelector('button[aria-label^="Notifications"]')?.getAttribute('aria-label')||''`);
    check("Notifications show unread before mark-read", poll(() => bellLabel().includes("unread")), bellLabel());
    evalJs("document.querySelector('.ob-leftnav').dataset.verifyNotifications='yes'");
    ex("click", 'a.ob-leftnav-item[href="/notifications"]');
    check("Full notifications page renders persisted items",
      poll(() => truthy(`document.querySelector('#notifications-title')?.textContent.trim()==='Notifications' &&
        document.querySelectorAll('.ob-notification-item').length > 0`)));
    check("Notification route keeps the shell and focus",
      exists('.ob-leftnav[data-verify-notifications="yes"]') &&
      exists('a.ob-leftnav-item[href="/notifications"].active') &&
      gotStr("document.activeElement?.id||''") === "main-content");
    clickText("Mark all read");
    check("Mark all read clears the unread badge (notifications.markAllRead persisted)",
      poll(() => bellLabel() === "Notifications"), bellLabel());
    evalJs(`document.querySelector('button[aria-label^="Notifications"]')?.click()`); pause(1);
    check("Notifications menu still opens from the full page", exists(".ob-menu"));
    evalJs("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))"); pause(1);

    // --- DM send (MessagesPage; persisted + delivered to B) ---
    if (bUser) {
      ex("type", 'input[aria-label="Search Openbook"]', bName);
      const resultReady = poll(() => truthy(`[...document.querySelectorAll('.ob-search .ob-menu button')].some(button=>button.textContent.includes(${JSON.stringify(bName)}))`));
      check("Browser people search finds the helper profile", resultReady);
      const openHelperProfile = () =>
        evalJs(`[...document.querySelectorAll('.ob-search .ob-menu button')].find(button=>button.textContent.includes(${JSON.stringify(bName)}))?.click()`);
      if (resultReady) openHelperProfile();
      let profileReady = poll(() => truthy(`location.pathname===${JSON.stringify(`/profile/${bUser.userId}`)}`));
      if (!profileReady && resultReady) {
        openHelperProfile();
        profileReady = poll(() => truthy(`location.pathname===${JSON.stringify(`/profile/${bUser.userId}`)}`));
      }
      check("Browser search opens the helper profile", profileReady);
      const messageButtonReady = profileReady && poll(() => exists('button[aria-label="Message"]'));
      check("Friend profile exposes the message action", messageButtonReady);
      if (messageButtonReady) ex("click", 'button[aria-label="Message"]');
      const composerReady = messageButtonReady && poll(() => exists('input[aria-label="Type a message"]'));
      check("Friend profile opens the message composer", composerReady);
      if (composerReady) {
        ex("type", 'input[aria-label="Type a message"]', dmText);
        clickText("Send");
        check("DM renders in A's thread (messages.send persisted)",
          poll(() => truthy(`[...document.querySelectorAll('.ob-msg.mine')].some(e=>e.textContent.includes(${JSON.stringify(dmText)}))`)));
        const bUnread = await bUser.client.query(fn("messages:unreadTotal"), {});
        check("DM delivered to B (unread reaches recipient)", bUnread >= 1, `unread=${bUnread}`);
      }
    }

    // --- Account menu ---
    evalJs(`[...document.querySelectorAll('.ob-iconbtn')].find(b=>(b.getAttribute('aria-label')||'')==='Account menu')?.click()`); pause(1);
    check("Account menu opens (Log out present)", bodyHas("Log out"));
    evalJs("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))"); pause(1);

    // --- Form structure on the product-creation routes ---
    evalJs(`document.querySelector('a.ob-leftnav-item[href="/groups"]')?.click()`); pause(2);
    check("Group form is named and every field has a label",
      truthy(`!!document.querySelector('form[aria-labelledby="create-group-title"]') &&
        [...document.querySelectorAll('form[aria-labelledby="create-group-title"] input, form[aria-labelledby="create-group-title"] textarea, form[aria-labelledby="create-group-title"] select')]
          .every(field=>field.name && field.labels?.length===1)`));
    evalJs(`document.querySelector('a.ob-leftnav-item[href="/events"]')?.click()`); pause(2);
    check("Event form is named and every field has a label",
      truthy(`!!document.querySelector('form[aria-labelledby="create-event-title"]') &&
        [...document.querySelectorAll('form[aria-labelledby="create-event-title"] input, form[aria-labelledby="create-event-title"] textarea')]
          .every(field=>field.name && field.labels?.length===1)`));

    // --- Settings page (real profiles.update mutation) ---
    evalJs(`document.querySelector('a.ob-leftnav-item[href="/settings"]')?.click()`); pause(3);
    check("Settings page renders with Save",
      bodyHas("Settings") &&
      truthy("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save changes')"));
    check("Settings profile editor is a named submit form",
      truthy(`!!document.querySelector('form[aria-labelledby="profile-settings-title"]') &&
        document.querySelector('input[name="displayName"]')?.labels?.length===1`));
    if (exists('input[name="displayName"]')) {
      ex("type", 'input[name="displayName"]', `${aName} edited`, "--timeout", "10s");
    }
    check("Browser type replaces the controlled settings value",
      gotStr(`document.querySelector('input[name="displayName"]')?.value||''`) === `${aName} edited`);
    clickText("Save changes");
    check("Settings save updates the reactive shell identity",
      poll(() => truthy(`document.querySelector('.ob-leftnav-me')?.innerText.includes(${JSON.stringify(`${aName} edited`)})`)));

    // --- Responsive navigation and form layout ---
    poll(() => !exists('.g-toast'), 5);
    ex("viewport", "390x844"); pause(1);
    ex("snapshot", "--role", "button,link", "--max", "80");
    check("Mobile layout uses the bottom nav and hides the desktop rail",
      truthy(`(()=>{const rail=document.querySelector('.ob-leftnav'); const nav=document.querySelector('.ob-nav-center');
        return !!rail && !!nav && getComputedStyle(rail).display==='none' &&
          getComputedStyle(nav).position==='fixed' && !!document.querySelector('a.ob-tab[href="/saved"]')})()`));
    check("Mobile layout has no horizontal overflow",
      truthy("document.documentElement.scrollWidth <= window.innerWidth"),
      gotStr("`${document.documentElement.scrollWidth}/${window.innerWidth}`"));
    ex("screenshot-current", "--out", "/tmp/ob-verify-mobile.png", "--viewport-only", "--timeout", "10s");
    ex("viewport", "1440x1000"); pause(1);
    check("Desktop left navigation is visible and sticky",
      truthy(`(()=>{const rail=document.querySelector('.ob-leftnav');
        return !!rail && getComputedStyle(rail).display!=='none' && getComputedStyle(rail).position==='sticky'})()`));

    ex("screenshot-current", "--out", "/tmp/ob-verify.png", "--viewport-only", "--timeout", "10s");
  } catch (e) {
    fail++; console.log(`  ✗ harness error — ${(e.message || "").split("\n")[0]}`);
  } finally {
    try { browser("close", S, "--purge-profile"); } catch {}
  }
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
