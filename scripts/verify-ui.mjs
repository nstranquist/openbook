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
import { execSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const NDEV = process.env.NDEV || "ndev";
const URL = process.env.URL || "http://localhost:5176/";
const S = process.env.SESSION || "ob-verify";
// The web app on :5176 is started with VITE_CONVEX_URL=http://127.0.0.1:3230 — the helper
// user must hit the SAME backend so its writes show up in A's browser.
const BACKEND =
  process.env.CONVEX_SELF_HOSTED_URL || process.env.VITE_CONVEX_URL || "http://127.0.0.1:3230";

const sh = (c) => execSync(c, { encoding: "utf8" });
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const browser = (a) => sh(`${NDEV} browser ${a}`);
const ex = (v, ...a) => browser(`exec ${S} ${v} ${a.map(q).join(" ")}`);
const evalJs = (js) => browser(`exec ${S} eval "" ${q(js)}`);
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
const pressEnter = () => ex("press", "\r");

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? `  — ${d}` : ""}`); } };
// Reactive Convex queries settle async — poll a predicate up to `tries` seconds.
const poll = (fn, tries = 6) => { for (let i = 0; i < tries; i++) { if (fn()) return true; sh("sleep 1"); } return fn(); };

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
    try { browser(`close ${S}`); } catch {} // clear a session left running by a killed run
    browser(`open ${S}`);
    ex("navigate", URL);
    sh("sleep 2");

    // The session profile persists auth across runs — if a previous run's user is
    // still signed in, log out so A is ALWAYS a fresh, uniquely-named signup.
    if (exists(".ob-nav")) {
      evalJs(`[...document.querySelectorAll('.ob-iconbtn')].find(b=>(b.getAttribute('aria-label')||'')==='Account menu')?.click()`); sh("sleep 1");
      clickHas("Log out"); sh("sleep 2");
    }

    // --- Signup A (Convex Auth + backend), unique display name ---
    clickText("Create new account"); sh("sleep 1");
    if (exists('input[placeholder="Full name"]')) ex("type", 'input[placeholder="Full name"]', aName);
    if (exists('input[placeholder="Email"]')) ex("type", 'input[placeholder="Email"]', `${aName.toLowerCase()}@openbook.local`);
    if (exists('input[placeholder="Password"]')) ex("type", 'input[placeholder="Password"]', "hunter2-verify");
    clickText("Sign up"); sh("sleep 5");
    check("Signup authenticates + reaches the feed", exists(".ob-nav"));

    // --- Create a post (backend write → reactive read) ---
    if (exists(".ob-composer-open")) { ex("click", ".ob-composer-open"); sh("sleep 1"); }
    if (exists(".ob-textarea")) ex("type", ".ob-textarea", body);
    clickText("Post"); sh("sleep 1");
    check("Post fires the DS toast", exists(".g-toast"));
    sh("sleep 1");
    check("Post persists + renders in the feed", bodyHas(body), "real backend round-trip");

    // A's own post links to A's profile — the most robust way to learn A's userId.
    const aHref = gotStr(`document.querySelector('article.ob-card a[href^="/profile/"]')?.getAttribute('href')||''`);
    aUserId = aHref.startsWith("/profile/") ? aHref.slice("/profile/".length) : null;

    // --- React to own post (reactions.toggle → myReaction persists) ---
    evalJs("document.querySelector('article.ob-card .ob-action')?.click()"); sh("sleep 2");
    check("Like reaction toggles on (reactions.toggle persisted)",
      exists("article.ob-card .ob-action.reacted"));

    // --- Comment on own post (comments.add → renders in thread) ---
    evalJs("[...document.querySelectorAll('article.ob-card')][0]?.querySelectorAll('.ob-action')[1]?.click()"); sh("sleep 1");
    if (exists('article.ob-card input[aria-label="Write a comment"]')) {
      ex("type", 'article.ob-card input[aria-label="Write a comment"]', commentText);
      pressEnter(); sh("sleep 2");
    }
    check("Comment posts + renders (comments.add persisted)",
      truthy(`document.querySelector('article.ob-card')?.innerText.includes(${JSON.stringify(commentText)})`));

    // --- Theme toggle (DS ThemeToggle) ---
    const before = got("document.documentElement.dataset.theme||'light'");
    evalJs("document.querySelector('.g-btn--icon')?.click()"); sh("sleep 1");
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
      ex("navigate", URL.replace(/\/$/, "") + "/friends"); sh("sleep 2");
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
    ex("navigate", URL); sh("sleep 2");
    const bellLabel = () => gotStr(`document.querySelector('button[aria-label^="Notifications"]')?.getAttribute('aria-label')||''`);
    check("Notifications show unread before mark-read", poll(() => bellLabel().includes("unread")), bellLabel());
    evalJs(`document.querySelector('button[aria-label^="Notifications"]')?.click()`); sh("sleep 1");
    check("Notifications menu opens", exists(".ob-menu"));
    clickText("Mark all read");
    check("Mark all read clears the unread badge (notifications.markAllRead persisted)",
      poll(() => bellLabel() === "Notifications"), bellLabel());
    evalJs("document.body.click()"); sh("sleep 1");

    // --- DM send (MessagesPage; persisted + delivered to B) ---
    if (bUser) {
      ex("navigate", URL.replace(/\/$/, "") + `/profile/${bUser.userId}`); sh("sleep 3");
      clickHas("Message");
      poll(() => exists('input[aria-label="Type a message"]'));
      if (exists('input[aria-label="Type a message"]')) ex("type", 'input[aria-label="Type a message"]', dmText);
      clickText("Send");
      check("DM renders in A's thread (messages.send persisted)",
        poll(() => truthy(`[...document.querySelectorAll('.ob-msg.mine')].some(e=>e.textContent.includes(${JSON.stringify(dmText)}))`)));
      const bUnread = await bUser.client.query(fn("messages:unreadTotal"), {});
      check("DM delivered to B (unread reaches recipient)", bUnread >= 1, `unread=${bUnread}`);
    }

    // --- Account menu ---
    evalJs(`[...document.querySelectorAll('.ob-iconbtn')].find(b=>(b.getAttribute('aria-label')||'')==='Account menu')?.click()`); sh("sleep 1");
    check("Account menu opens (Log out present)", bodyHas("Log out"));

    // --- Settings page (real profiles.update mutation) ---
    ex("navigate", URL.replace(/\/$/, "") + "/settings"); sh("sleep 3");
    check("Settings page renders with Save",
      bodyHas("Settings") &&
      truthy("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save changes')"));
    if (exists("input.g-input")) ex("type", "input.g-input", ` (edited ${stamp})`);
    clickText("Save changes"); sh("sleep 1");
    check("Settings save fires toast (profiles.update round-trip)", exists(".g-toast"));

    ex("screenshot-current", "--out", "/tmp/ob-verify.png");
  } catch (e) {
    fail++; console.log(`  ✗ harness error — ${(e.message || "").split("\n")[0]}`);
  } finally {
    try { browser(`close ${S}`); } catch {}
  }
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
