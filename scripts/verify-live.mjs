// Headless live end-to-end proof for Openbook against a REAL Convex backend.
//
// Unlike `pnpm test` (convex-test simulates the backend) and `tsc` (types only),
// this drives the ACTUAL deployed functions over the wire, as three users:
// sign-up → people search → friend request → accept → posts (public+friends) →
// feed visibility → saved posts → reactions → comments → notifications → DM
// round-trip with unread accounting → delete cascade → billing plan readout.
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
  const aliceFriendPage = await alice.client.query(fn("friends:listPage"), {
    paginationOpts: { numItems: 1, cursor: null },
  });
  check(
    "friend count and paginated graph are exact",
    (await alice.client.query(fn("friends:count"), {})) === 1 &&
      aliceFriendPage.page.some((f) => f.userId === bob.userId),
  );

  // 4) Posts: one friends-only, one public.
  const friendsPostId = await alice.client.mutation(fn("posts:create"), {
    body: `friends-only-${stamp}`, audience: "friends",
  });
  const publicPostId = await alice.client.mutation(fn("posts:create"), {
    body: `public-${stamp}`, audience: "public",
  });
  check("posts created", !!friendsPostId && !!publicPostId);

  const previewPostId = await alice.client.mutation(fn("posts:create"), {
    body: "https://example.com/",
    audience: "public",
  });
  let previewPost = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    previewPost = await alice.client.query(fn("posts:get"), { id: previewPostId });
    if (previewPost?.linkPreview?.title) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check(
    "server-side link preview fetch completes",
    previewPost?.linkPreview?.url === "https://example.com/" &&
      /example domain/i.test(previewPost?.linkPreview?.title ?? ""),
  );

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

  const bobPostBeforeSave = await bob.client.query(fn("posts:get"), { id: friendsPostId });
  check("visible post starts unsaved", bobPostBeforeSave?.isSaved === false);
  check("friend can save a visible post",
    (await bob.client.mutation(fn("saved:toggle"), { postId: friendsPostId })) === true);
  const bobSaved = await bob.client.query(fn("saved:list"), { paginationOpts: PAGE });
  check("saved list is private and returns the post",
    bobSaved.page.some((saved) => saved._id === friendsPostId) &&
      (await alice.client.query(fn("saved:list"), { paginationOpts: PAGE })).page.length === 0);
  let hiddenSaveRejected = false;
  try {
    await mallory.client.mutation(fn("saved:toggle"), { postId: friendsPostId });
  } catch {
    hiddenSaveRejected = true;
  }
  check("stranger cannot save a friends-only post", hiddenSaveRejected);

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
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploadGrant = await alice.client.mutation(fn("posts:generateUploadUrl"), {
      kind: "image",
      declaredBytes: png.length,
    });
    const uploaded = await fetch(uploadGrant.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    check("image upload accepted", uploaded.ok, `HTTP ${uploaded.status}`);
    if (uploaded.ok) {
      const { storageId } = await uploaded.json();
      await alice.client.mutation(fn("posts:registerImage"), {
        storageId,
        grantId: uploadGrant.grantId,
      });
      const photoId = await alice.client.mutation(fn("posts:create"), {
        body: `photo-${stamp}`, audience: "public", imageId: storageId,
      });
      const photo = await bob.client.query(fn("posts:get"), { id: photoId });
      check("photo post has an image URL", !!photo?.imageUrl);
      if (photo?.imageUrl) {
        const mediaUrl = new globalThis.URL(photo.imageUrl);
        const signedRoute =
          mediaUrl.pathname === "/media" &&
          mediaUrl.searchParams.get("id") === storageId &&
          /^\d+$/.test(mediaUrl.searchParams.get("exp") ?? "") &&
          /^[a-f0-9]{64}$/.test(mediaUrl.searchParams.get("sig") ?? "");
        check("photo uses the signed media route", signedRoute);

        const fullMedia = await fetch(mediaUrl);
        const fullBody = Buffer.from(await fullMedia.arrayBuffer());
        const cacheSeconds = Number(
          /max-age=(\d+)/.exec(fullMedia.headers.get("cache-control") ?? "")?.[1] ?? "-1",
        );
        check("signed media returns the exact image", fullMedia.status === 200 && fullBody.equals(png));
        check(
          "signed media sends hardened response headers",
          fullMedia.headers.get("x-content-type-options") === "nosniff" &&
            fullMedia.headers.get("content-security-policy") === "default-src 'none'; sandbox" &&
            fullMedia.headers.get("accept-ranges") === "bytes" &&
            fullMedia.headers.get("content-type") === "image/png" &&
            cacheSeconds >= 0 && cacheSeconds <= 3600,
        );

        const partialMedia = await fetch(mediaUrl, { headers: { Range: "bytes=0-0" } });
        const partialBody = Buffer.from(await partialMedia.arrayBuffer());
        check(
          "signed media serves a bounded byte range",
          partialMedia.status === 206 &&
            partialBody.length === 1 &&
            partialBody[0] === png[0] &&
            partialMedia.headers.get("content-range") === `bytes 0-0/${png.length}` &&
            partialMedia.headers.get("content-length") === "1",
        );

        const invalidRange = await fetch(mediaUrl, { headers: { Range: "bytes=999999-" } });
        check(
          "signed media rejects an unsatisfied byte range",
          invalidRange.status === 416 &&
            invalidRange.headers.get("content-range") === `bytes */${png.length}`,
        );
      }
    }
  } catch (err) {
    check("image and signed-media workflow completes", false, err instanceof Error ? err.message : String(err));
  }

  try {
    const albumId = await alice.client.mutation(fn("albums:create"), { title: `Album ${stamp}` });
    const albumPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const albumGrant = await alice.client.mutation(fn("posts:generateUploadUrl"), {
      kind: "image",
      declaredBytes: albumPng.length,
    });
    const albumUpload = await fetch(albumGrant.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: albumPng,
    });
    if (!albumUpload.ok) throw new Error(`album upload HTTP ${albumUpload.status}`);
    const { storageId } = await albumUpload.json();
    await alice.client.mutation(fn("posts:registerImage"), {
      storageId,
      grantId: albumGrant.grantId,
    });
    await alice.client.mutation(fn("albums:addPhoto"), { albumId, imageId: storageId });
    const albums = await alice.client.query(fn("albums:listPage"), {
      userId: alice.userId,
      paginationOpts: PAGE,
    });
    check(
      "album photo follows registered ownership and paginated reads",
      albums.page.some((album) => album._id === albumId && album.itemCount === 1),
    );
  } catch (err) {
    check("album photo follows registered ownership and paginated reads", false,
      err instanceof Error ? err.message : String(err));
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
  const aliceNotifPage = await alice.client.query(fn("notifications:listPage"), {
    paginationOpts: PAGE,
  });
  check("notification page reads the same recipient-scoped events",
    aliceNotifPage.page.some((n) => n.kind === "reaction") &&
      aliceNotifPage.page.some((n) => n.kind === "comment"));
  await alice.client.mutation(fn("notifications:markAllRead"), {});
  check("mark-all-read clears the bell",
    (await alice.client.query(fn("notifications:unreadCount"), {})) === 0);

  // 7) Realtime DMs with unread accounting.
  const conversationId = await bob.client.mutation(fn("messages:open"), { userId: alice.userId });
  await bob.client.mutation(fn("messages:send"), { conversationId, body: "hey alice" });
  await bob.client.mutation(fn("messages:send"), { conversationId, body: "ping" });
  check("DM unread total reaches the recipient",
    (await alice.client.query(fn("messages:unreadTotal"), {})) === 2);
  const aliceConvs = await alice.client.query(fn("messages:myConversationsPage"), {
    paginationOpts: PAGE,
  });
  const conversationSummary = await alice.client.query(fn("messages:conversationSummary"), {
    conversationId,
  });
  check("paginated conversation preview and direct summary show the last message",
    aliceConvs.page[0]?.lastMessageBody === "ping" &&
      aliceConvs.page[0]?.other?.userId === bob.userId &&
      conversationSummary?.lastMessageBody === "ping");
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
  check("deleted post leaves saved lists",
    !(await bob.client.query(fn("saved:list"), { paginationOpts: PAGE })).page
      .some((saved) => saved._id === friendsPostId));

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
