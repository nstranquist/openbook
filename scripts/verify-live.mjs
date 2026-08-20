// Headless live end-to-end proof for Openbook against a REAL Convex backend.
//
// Unlike `pnpm test` (convex-test simulates the backend) and `tsc` (types only),
// this drives the ACTUAL deployed functions over the wire, as three users:
// sign-up → people search → friend request → accept → posts (public+friends) →
// feed visibility → reactions → comments → notifications → DM round-trip with
// unread accounting → delete cascade → billing plan gate readout.
//
//   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3310 node scripts/verify-live.mjs   # self-hosted (dev-selfhost.sh)
//   VITE_CONVEX_URL=https://<your>.convex.cloud   node scripts/verify-live.mjs   # cloud dev/prod

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const URL =
  process.env.CONVEX_SELF_HOSTED_URL ||
  process.env.VITE_CONVEX_URL ||
  process.env.CONVEX_URL ||
  "http://127.0.0.1:3310";

const fn = (name) => makeFunctionReference(name);
let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const stamp = Date.now();
const PAGE = { numItems: 20, cursor: null };

async function signUp(name) {
  const client = new ConvexHttpClient(URL);
  const res = await client.action(fn("auth:signIn"), {
    provider: "password",
    params: {
      email: `${name.toLowerCase()}+${stamp}@example.test`,
      password: `Pw-${stamp}-aA1!`,
      flow: "signUp",
    },
  });
  const token = res?.tokens?.token;
  if (!token) throw new Error(`no auth token for ${name}: ${JSON.stringify(res)}`);
  client.setAuth(token);
  await client.mutation(fn("profiles:ensure"), { displayName: `${name} E2E${stamp}` });
  const me = await client.query(fn("profiles:me"), {});
  return { client, name, userId: me.userId, displayName: me.displayName };
}

async function main() {
  console.log(`Openbook live E2E → ${URL}\n`);

  // 1) Three real users sign up and get profiles.
  const alice = await signUp("Alice");
  const bob = await signUp("Bob");
  const mallory = await signUp("Mallory");
  check("3 users signed up with profiles", !!(alice.userId && bob.userId && mallory.userId));

  // 2) People search over the live full-text index.
  const hits = await alice.client.query(fn("profiles:search"), { q: `Bob E2E${stamp}` });
  check("people search finds Bob", hits.some((h) => h.userId === bob.userId));

  // 3) Friend request → notification → accept → mutual friends.
  await alice.client.mutation(fn("friends:sendRequest"), { userId: bob.userId });
  const bobUnread = await bob.client.query(fn("notifications:unreadCount"), {});
  check("friend request notifies Bob (unread=1)", bobUnread === 1, `got ${bobUnread}`);
  await bob.client.mutation(fn("friends:accept"), { userId: alice.userId });
  const aliceFriends = await alice.client.query(fn("friends:list"), {});
  check("Alice and Bob are mutual friends",
    aliceFriends.some((f) => f.userId === bob.userId));

  // 4) Posts: one friends-only, one public.
  const friendsPostId = await alice.client.mutation(fn("posts:create"), {
    body: `friends-only-${stamp}`, audience: "friends",
  });
  const publicPostId = await alice.client.mutation(fn("posts:create"), {
    body: `public-${stamp}`, audience: "public",
  });
  check("posts created", !!friendsPostId && !!publicPostId);

  // 5) Feed visibility: friend sees both, stranger only the public one.
  const bobFeed = await bob.client.query(fn("posts:feed"), { paginationOpts: PAGE });
  const bobBodies = bobFeed.page.map((p) => p.body);
  check("friend's feed has the friends-only post", bobBodies.includes(`friends-only-${stamp}`));
  const malloryFeed = await mallory.client.query(fn("posts:feed"), { paginationOpts: PAGE });
  const malloryBodies = malloryFeed.page.map((p) => p.body);
  check("stranger's feed has the public post", malloryBodies.includes(`public-${stamp}`));
  check("stranger's feed hides the friends-only post", !malloryBodies.includes(`friends-only-${stamp}`));

  let strangerCommentRejected = false;
  try {
    await mallory.client.mutation(fn("comments:add"), { postId: friendsPostId, body: "leak" });
  } catch {
    strangerCommentRejected = true;
  }
  check("stranger cannot comment on a friends-only post", strangerCommentRejected);
  const leakedComments = await mallory.client.query(fn("comments:list"), {
    postId: friendsPostId,
    paginationOpts: PAGE,
  });
  check("stranger cannot list friends-only comments", leakedComments.page.length === 0);
  let strangerReactRejected = false;
  try {
    await mallory.client.mutation(fn("reactions:toggle"), { postId: friendsPostId, kind: "like" });
  } catch {
    strangerReactRejected = true;
  }
  check("stranger cannot react to a friends-only post", strangerReactRejected);

  await alice.client.mutation(fn("blocks:set"), { userId: mallory.userId, blocked: true });
  const malloryAfterBlock = await mallory.client.query(fn("posts:get"), { id: friendsPostId });
  check("block hides the author's friends-only post", malloryAfterBlock === null);
  await alice.client.mutation(fn("blocks:set"), { userId: mallory.userId, blocked: false });

  await mallory.client.mutation(fn("mutes:set"), { userId: alice.userId, muted: true });
  const malloryMutedFeed = await mallory.client.query(fn("posts:feed"), { paginationOpts: PAGE });
  check("mute hides public posts from the muter's feed",
    !malloryMutedFeed.page.some((p) => p.body === `public-${stamp}`));
  check("mute does not hide the post permalink",
    !!(await mallory.client.query(fn("posts:get"), { id: publicPostId })));
  await mallory.client.mutation(fn("mutes:set"), { userId: alice.userId, muted: false });

  const groupId = await alice.client.mutation(fn("groups:create"), {
    name: `Club ${stamp}`, description: "", kind: "group",
  });
  await bob.client.mutation(fn("groups:join"), { groupId });
  const groupPostId = await alice.client.mutation(fn("posts:create"), {
    body: `group-${stamp}`, audience: "public", groupId,
  });
  check("group member can see a group post",
    !!(await bob.client.query(fn("posts:get"), { id: groupPostId })));
  check("non-member cannot see a group post",
    (await mallory.client.query(fn("posts:get"), { id: groupPostId })) === null);

  try {
    const uploadUrl = await alice.client.mutation(fn("posts:generateUploadUrl"), {});
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    check("image upload accepted", uploaded.ok, `HTTP ${uploaded.status}`);
    if (uploaded.ok) {
      const { storageId } = await uploaded.json();
      await alice.client.mutation(fn("posts:registerImage"), { storageId });
      const photoId = await alice.client.mutation(fn("posts:create"), {
        body: `photo-${stamp}`, audience: "public", imageId: storageId,
      });
      const photo = await bob.client.query(fn("posts:get"), { id: photoId });
      check("photo post has an image URL", !!photo?.imageUrl);
    }
  } catch (err) {
    check("image upload accepted", false, err instanceof Error ? err.message : String(err));
  }

  // 6) Reactions + comments, with denormalized tallies + notifications.
  await bob.client.mutation(fn("reactions:toggle"), { postId: friendsPostId, kind: "love" });
  await bob.client.mutation(fn("comments:add"), { postId: friendsPostId, body: "nice post!" });
  const aliceFeed = await alice.client.query(fn("posts:feed"), { paginationOpts: PAGE });
  const post = aliceFeed.page.find((p) => p._id === friendsPostId);
  check("reaction tallied on the post", post?.reactionCounts?.love === 1);
  check("comment counted on the post", post?.commentCount === 1);
  const aliceNotifs = await alice.client.query(fn("notifications:list"), {});
  check("Alice notified of reaction + comment",
    aliceNotifs.some((n) => n.kind === "reaction") && aliceNotifs.some((n) => n.kind === "comment"));
  await alice.client.mutation(fn("notifications:markAllRead"), {});
  check("mark-all-read clears the bell",
    (await alice.client.query(fn("notifications:unreadCount"), {})) === 0);

  // 7) Realtime DMs with unread accounting.
  const conversationId = await bob.client.mutation(fn("messages:open"), { userId: alice.userId });
  await bob.client.mutation(fn("messages:send"), { conversationId, body: "hey alice" });
  await bob.client.mutation(fn("messages:send"), { conversationId, body: "ping" });
  check("DM unread total reaches the recipient",
    (await alice.client.query(fn("messages:unreadTotal"), {})) === 2);
  const aliceConvs = await alice.client.query(fn("messages:myConversations"), {});
  check("conversation preview shows last message",
    aliceConvs[0]?.lastMessageBody === "ping" && aliceConvs[0]?.other?.userId === bob.userId);
  await alice.client.mutation(fn("messages:markRead"), { conversationId });
  check("markRead zeroes the unread badge",
    (await alice.client.query(fn("messages:unreadTotal"), {})) === 0);
  const thread = await alice.client.query(fn("messages:list"), { conversationId, paginationOpts: PAGE });
  check("thread reads back both messages", thread.page.length === 2);

  // 8) Author-only delete cascades comments/reactions.
  let strangerDeleteRejected = false;
  try {
    await mallory.client.mutation(fn("posts:remove"), { id: friendsPostId });
  } catch { strangerDeleteRejected = true; }
  check("non-author cannot delete a post", strangerDeleteRejected);
  await alice.client.mutation(fn("posts:remove"), { id: friendsPostId });
  const afterDelete = await bob.client.query(fn("posts:feed"), { paginationOpts: PAGE });
  check("deleted post leaves every feed",
    !afterDelete.page.some((p) => p._id === friendsPostId));

  // 9) Billing spine still reports the plan + usage (posts gate).
  const plan = await alice.client.query(fn("billing:getMyPlan"), {});
  check("free plan reports post usage against the 100 cap",
    plan?.plan === "free" && plan?.limits?.posts === 100 && plan?.usage?.posts >= 1,
    JSON.stringify(plan));

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ""}`);
  if (failures.length) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
