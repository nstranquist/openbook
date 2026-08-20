import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { modules } from "./test.setup";
import { pairKey } from "./lib/social";

// The social domain against the real schema: friendship lifecycle, feed
// visibility, exact denormalized tallies, notification fan-out, and DM unread
// accounting. Each rule here is one a wrong edit silently breaks.

type T = ReturnType<typeof convexTest>;

async function newUser(t: T, email: string) {
  return await t.run(async (ctx) => ctx.db.insert("users", { email } as any));
}

// A signed-in actor with a profile, the way every real session starts.
async function actor(t: T, name: string) {
  const userId = await newUser(t, `${name.toLowerCase()}@example.test`);
  const as = t.withIdentity({ subject: userId });
  await as.mutation(api.profiles.ensure, { displayName: name });
  return { userId, as };
}

async function befriend(a: { as: any; userId: Id<"users"> }, b: { as: any; userId: Id<"users"> }) {
  await a.as.mutation(api.friends.sendRequest, { userId: b.userId });
  await b.as.mutation(api.friends.accept, { userId: a.userId });
}

const firstPage = { numItems: 20, cursor: null };

describe("profiles", () => {
  it("ensure is idempotent and creates exactly one profile", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t, "alice@example.test");
    const as = t.withIdentity({ subject: userId });
    const id1 = await as.mutation(api.profiles.ensure, { displayName: "Alice" });
    const id2 = await as.mutation(api.profiles.ensure, {});
    expect(id1).toBe(id2);
    const me = await as.query(api.profiles.me, {});
    expect(me?.displayName).toBe("Alice");
  });

  it("update validates and persists; empty display name rejected", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    await alice.as.mutation(api.profiles.update, {
      bio: "Hello there", work: "Openbook", location: "Internet",
    });
    const me = await alice.as.query(api.profiles.me, {});
    expect(me?.bio).toBe("Hello there");
    await expect(
      alice.as.mutation(api.profiles.update, { displayName: "  " }),
    ).rejects.toThrow(/empty/i);
  });

  it("search finds people by name and annotates friendship", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob Marley");
    await befriend(alice, bob);
    const hits = await alice.as.query(api.profiles.search, { q: "Marley" });
    expect(hits).toHaveLength(1);
    expect(hits[0].displayName).toBe("Bob Marley");
    expect(hits[0].isFriend).toBe(true);
  });
});

describe("friendship lifecycle", () => {
  it("request → accept makes both sides friends and notifies both directions", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");

    await alice.as.mutation(api.friends.sendRequest, { userId: bob.userId });
    const bobReqs = await bob.as.query(api.friends.requests, {});
    expect(bobReqs.incoming.map((c: any) => c.userId)).toContain(alice.userId);

    await bob.as.mutation(api.friends.accept, { userId: alice.userId });
    const aliceFriends = await alice.as.query(api.friends.list, {});
    const bobFriends = await bob.as.query(api.friends.list, {});
    expect(aliceFriends.map((c: any) => c.userId)).toContain(bob.userId);
    expect(bobFriends.map((c: any) => c.userId)).toContain(alice.userId);

    // request notified Bob; accept notified Alice
    const bobNotifs = await bob.as.query(api.notifications.list, {});
    expect(bobNotifs.some((n: any) => n.kind === "friend_request")).toBe(true);
    const aliceNotifs = await alice.as.query(api.notifications.list, {});
    expect(aliceNotifs.some((n: any) => n.kind === "friend_accept")).toBe(true);
  });

  it("self-request, duplicate request, and double-accept are rejected", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await expect(
      alice.as.mutation(api.friends.sendRequest, { userId: alice.userId }),
    ).rejects.toThrow(/yourself/i);
    await alice.as.mutation(api.friends.sendRequest, { userId: bob.userId });
    await expect(
      alice.as.mutation(api.friends.sendRequest, { userId: bob.userId }),
    ).rejects.toThrow(/already sent/i);
    await bob.as.mutation(api.friends.accept, { userId: alice.userId });
    await expect(
      bob.as.mutation(api.friends.accept, { userId: alice.userId }),
    ).rejects.toThrow(/no incoming/i);
    await expect(
      alice.as.mutation(api.friends.sendRequest, { userId: bob.userId }),
    ).rejects.toThrow(/already friends/i);
  });

  it("a cross-request (B requests A while A→B pending) auto-accepts", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await alice.as.mutation(api.friends.sendRequest, { userId: bob.userId });
    await bob.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    const friends = await alice.as.query(api.friends.list, {});
    expect(friends.map((c: any) => c.userId)).toContain(bob.userId);
  });

  it("decline, cancel, and unfriend remove the edge", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");

    await alice.as.mutation(api.friends.sendRequest, { userId: bob.userId });
    await bob.as.mutation(api.friends.decline, { userId: alice.userId });
    expect((await bob.as.query(api.friends.requests, {})).incoming).toHaveLength(0);

    await alice.as.mutation(api.friends.sendRequest, { userId: bob.userId });
    await alice.as.mutation(api.friends.cancelRequest, { userId: bob.userId });
    expect((await alice.as.query(api.friends.requests, {})).outgoing).toHaveLength(0);

    await befriend(alice, bob);
    await alice.as.mutation(api.friends.unfriend, { userId: bob.userId });
    expect(await alice.as.query(api.friends.list, {})).toHaveLength(0);
    expect(await bob.as.query(api.friends.list, {})).toHaveLength(0);
  });

  it("suggestions rank friends-of-friends by mutual count and exclude existing edges", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const carol = await actor(t, "Carol");
    const dave = await actor(t, "Dave");
    // Alice—Bob, Alice—Carol; Bob—Dave, Carol—Dave ⇒ Dave has 2 mutuals with Alice.
    await befriend(alice, bob);
    await befriend(alice, carol);
    await befriend(bob, dave);
    await befriend(carol, dave);
    const suggestions = await alice.as.query(api.friends.suggestions, {});
    const top = suggestions[0];
    expect(top.userId).toBe(dave.userId);
    expect(top.mutualCount).toBe(2);
    // Bob is already a friend — never suggested.
    expect(suggestions.map((s: any) => s.userId)).not.toContain(bob.userId);
  });

  it("suggestions exclude pending request peers (outgoing and incoming)", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const eve = await actor(t, "Eve");
    const frank = await actor(t, "Frank");
    // FoF path: Alice—Bob—Eve would otherwise suggest Eve.
    await befriend(alice, bob);
    await befriend(bob, eve);
    // Pending edges should not appear as suggestions either.
    await alice.as.mutation(api.friends.sendRequest, { userId: frank.userId });
    await eve.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    const suggestions = await alice.as.query(api.friends.suggestions, {});
    const ids = suggestions.map((s: any) => s.userId);
    expect(ids).not.toContain(frank.userId);
    expect(ids).not.toContain(eve.userId);
    expect(ids).not.toContain(bob.userId);
  });
});

describe("posts + feed visibility", () => {
  it("friends-audience posts reach friends but not strangers; public posts reach everyone", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    await befriend(alice, bob);

    await alice.as.mutation(api.posts.create, {
      body: "friends only", audience: "friends",
    });
    await alice.as.mutation(api.posts.create, {
      body: "hello world", audience: "public",
    });

    const bobFeed = await bob.as.query(api.posts.feed, { paginationOpts: firstPage });
    expect(bobFeed.page.map((p: any) => p.body)).toEqual(
      expect.arrayContaining(["friends only", "hello world"]),
    );

    const malloryFeed = await mallory.as.query(api.posts.feed, { paginationOpts: firstPage });
    const malloryBodies = malloryFeed.page.map((p: any) => p.body);
    expect(malloryBodies).toContain("hello world");
    expect(malloryBodies).not.toContain("friends only");

    // Profile timeline applies the same rule.
    const malloryView = await mallory.as.query(api.posts.forProfile, {
      userId: alice.userId, paginationOpts: firstPage,
    });
    expect(malloryView.page.map((p: any) => p.body)).toEqual(["hello world"]);
  });

  it("feed scan fills a page when the newest posts are hidden", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    await alice.as.mutation(api.posts.create, {
      body: "visible public", audience: "public",
    });
    for (let i = 0; i < 5; i++) {
      await alice.as.mutation(api.posts.create, {
        body: `secret-${i}`, audience: "friends",
      });
    }
    const page = await mallory.as.query(api.posts.feed, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(page.page.map((p: any) => p.body)).toContain("visible public");
    expect(page.page.every((p: any) => !String(p.body).startsWith("secret-"))).toBe(true);
    expect(page.isDone).toBe(true);
  });

  it("posts.get hides friends-only posts from strangers", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "private", audience: "friends",
    });
    expect(await alice.as.query(api.posts.get, { id: postId })).not.toBeNull();
    expect(await mallory.as.query(api.posts.get, { id: postId })).toBeNull();
  });

  it("feed is newest-first and enriched with author card + my reaction", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    await alice.as.mutation(api.posts.create, { body: "first", audience: "public" });
    await alice.as.mutation(api.posts.create, { body: "second", audience: "public" });
    const feed = await alice.as.query(api.posts.feed, { paginationOpts: firstPage });
    expect(feed.page.map((p: any) => p.body)).toEqual(["second", "first"]);
    expect(feed.page[0].author.displayName).toBe("Alice");
    expect(feed.page[0].myReaction).toBeNull();
    expect(feed.page[0].reactionTotal).toBe(0);
  });

  it("empty posts are rejected; deleting cascades comments + reactions", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    await expect(
      alice.as.mutation(api.posts.create, { body: "   ", audience: "public" }),
    ).rejects.toThrow(/empty/i);

    const postId = await alice.as.mutation(api.posts.create, {
      body: "to be deleted", audience: "public",
    });
    await bob.as.mutation(api.comments.add, { postId, body: "nice" });
    await bob.as.mutation(api.reactions.toggle, { postId, kind: "like" });

    // Only the author may delete.
    await expect(bob.as.mutation(api.posts.remove, { id: postId })).rejects.toThrow(/author/i);
    await alice.as.mutation(api.posts.remove, { id: postId });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(postId)).toBeNull();
      const comments = await ctx.db.query("comments").collect();
      const reactions = await ctx.db.query("reactions").collect();
      expect(comments).toHaveLength(0);
      expect(reactions).toHaveLength(0);
    });
  });
});

describe("reactions", () => {
  it("toggle adds, switches, and removes; denormalized tallies stay exact", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const postId = await alice.as.mutation(api.posts.create, {
      body: "react to me", audience: "public",
    });

    await bob.as.mutation(api.reactions.toggle, { postId, kind: "like" });
    await alice.as.mutation(api.reactions.toggle, { postId, kind: "love" });
    let feed = await bob.as.query(api.posts.feed, { paginationOpts: firstPage });
    let post = feed.page.find((p: any) => p._id === postId)!;
    expect(post.reactionCounts.like).toBe(1);
    expect(post.reactionCounts.love).toBe(1);
    expect(post.reactionTotal).toBe(2);
    expect(post.myReaction).toBe("like");

    // Switch kind: like → haha (total unchanged).
    await bob.as.mutation(api.reactions.toggle, { postId, kind: "haha" });
    feed = await bob.as.query(api.posts.feed, { paginationOpts: firstPage });
    post = feed.page.find((p: any) => p._id === postId)!;
    expect(post.reactionCounts.like).toBe(0);
    expect(post.reactionCounts.haha).toBe(1);
    expect(post.reactionTotal).toBe(2);
    expect(post.myReaction).toBe("haha");

    // Same kind again: removed.
    await bob.as.mutation(api.reactions.toggle, { postId, kind: "haha" });
    feed = await bob.as.query(api.posts.feed, { paginationOpts: firstPage });
    post = feed.page.find((p: any) => p._id === postId)!;
    expect(post.reactionTotal).toBe(1);
    expect(post.myReaction).toBeNull();
  });

  it("only a NEW reaction notifies the author; self-reaction never does", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const postId = await alice.as.mutation(api.posts.create, {
      body: "notify me once", audience: "public",
    });
    await alice.as.mutation(api.reactions.toggle, { postId, kind: "like" }); // self
    await bob.as.mutation(api.reactions.toggle, { postId, kind: "like" }); // new → notify
    await bob.as.mutation(api.reactions.toggle, { postId, kind: "wow" }); // switch → no re-ping
    const notifs = await alice.as.query(api.notifications.list, {});
    expect(notifs.filter((n: any) => n.kind === "reaction")).toHaveLength(1);
  });

  it("strangers cannot react to or list reactions on a friends-only post", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "friends only", audience: "friends",
    });
    await expect(
      mallory.as.mutation(api.reactions.toggle, { postId, kind: "like" }),
    ).rejects.toThrow(/not found/i);
    expect(await mallory.as.query(api.reactions.listForPost, { postId })).toEqual([]);
  });
});

describe("comments", () => {
  it("commentCount tracks add/remove; author or post owner can delete", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const carol = await actor(t, "Carol");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "discuss", audience: "public",
    });
    const c1 = await bob.as.mutation(api.comments.add, { postId, body: "first!" });
    await carol.as.mutation(api.comments.add, { postId, body: "second" });

    let feed = await alice.as.query(api.posts.feed, { paginationOpts: firstPage });
    expect(feed.page[0].commentCount).toBe(2);

    // Carol may not delete Bob's comment; Alice (post owner) may.
    await expect(carol.as.mutation(api.comments.remove, { id: c1 })).rejects.toThrow(/not allowed/i);
    await alice.as.mutation(api.comments.remove, { id: c1 });
    feed = await alice.as.query(api.posts.feed, { paginationOpts: firstPage });
    expect(feed.page[0].commentCount).toBe(1);

    const comments = await alice.as.query(api.comments.list, { postId });
    expect(comments).toHaveLength(1);
    expect(comments[0].author.displayName).toBe("Carol");
    // Alice got exactly 2 comment notifications (none for her own actions).
    const notifs = await alice.as.query(api.notifications.list, {});
    expect(notifs.filter((n: any) => n.kind === "comment")).toHaveLength(2);
  });

  it("friends-only comments are hidden after unfriend", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const postId = await alice.as.mutation(api.posts.create, {
      body: "friends thread", audience: "friends",
    });
    await bob.as.mutation(api.comments.add, { postId, body: "hi" });
    expect(await bob.as.query(api.comments.list, { postId })).toHaveLength(1);

    await alice.as.mutation(api.friends.unfriend, { userId: bob.userId });
    expect(await bob.as.query(api.comments.list, { postId })).toEqual([]);
    await expect(
      bob.as.mutation(api.comments.add, { postId, body: "still here?" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("notifications", () => {
  it("unreadCount, markRead, markAllRead", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const carol = await actor(t, "Carol");
    await bob.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    await carol.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(2);

    const list = await alice.as.query(api.notifications.list, {});
    await alice.as.mutation(api.notifications.markRead, { id: list[0]._id });
    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(1);

    await alice.as.mutation(api.notifications.markAllRead, {});
    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(0);
    // Reads are recipient-scoped: Bob sees none of Alice's notifications.
    expect(await bob.as.query(api.notifications.list, {})).toHaveLength(0);
  });

  it("list is newest-first even after older items are marked read", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const carol = await actor(t, "Carol");
    await bob.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    await carol.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    const list = await alice.as.query(api.notifications.list, {});
    expect(list[0].actor.displayName).toBe("Carol");
    await alice.as.mutation(api.notifications.markRead, { id: list[1]._id });
    const again = await alice.as.query(api.notifications.list, {});
    expect(again[0].actor.displayName).toBe("Carol");
    expect(again[0].read).toBe(false);
    expect(again[1].read).toBe(true);
  });
});

describe("messages", () => {
  it("open is idempotent per pair; send updates preview + unread; markRead clears", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);

    const conv1 = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    const conv2 = await bob.as.mutation(api.messages.open, { userId: alice.userId });
    expect(conv1).toBe(conv2);

    await alice.as.mutation(api.messages.send, { conversationId: conv1, body: "hey Bob" });
    await alice.as.mutation(api.messages.send, { conversationId: conv1, body: "you there?" });

    expect(await bob.as.query(api.messages.unreadTotal, {})).toBe(2);
    expect(await alice.as.query(api.messages.unreadTotal, {})).toBe(0);

    const bobConvs = await bob.as.query(api.messages.myConversations, {});
    expect(bobConvs).toHaveLength(1);
    expect(bobConvs[0].lastMessageBody).toBe("you there?");
    expect(bobConvs[0].unreadCount).toBe(2);
    expect(bobConvs[0].other.displayName).toBe("Alice");

    await bob.as.mutation(api.messages.markRead, { conversationId: conv1 });
    expect(await bob.as.query(api.messages.unreadTotal, {})).toBe(0);

    const thread = await bob.as.query(api.messages.list, {
      conversationId: conv1, paginationOpts: firstPage,
    });
    // Newest-first pagination; isMine is viewer-relative.
    expect(thread.page.map((m: any) => m.body)).toEqual(["you there?", "hey Bob"]);
    expect(thread.page[0].isMine).toBe(false);
  });

  it("non-participants cannot read or send; self-DM rejected", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    await befriend(alice, bob);
    const conv = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await alice.as.mutation(api.messages.send, { conversationId: conv, body: "secret" });

    await expect(
      mallory.as.mutation(api.messages.send, { conversationId: conv, body: "hi" }),
    ).rejects.toThrow(/participant/i);
    const leaked = await mallory.as.query(api.messages.list, {
      conversationId: conv, paginationOpts: firstPage,
    });
    expect(leaked.page).toHaveLength(0);

    await expect(
      alice.as.mutation(api.messages.open, { userId: alice.userId }),
    ).rejects.toThrow(/yourself/i);
  });

  it("strangers cannot open a new conversation", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    await expect(
      mallory.as.mutation(api.messages.open, { userId: alice.userId }),
    ).rejects.toThrow(/friends/i);
  });

  it("open keeps messages when a newer empty pair-row exists", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const conv = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await alice.as.mutation(api.messages.send, { conversationId: conv, body: "keep me" });
    await t.run(async (ctx) => {
      const now = Date.now() + 5_000;
      const extra = await ctx.db.insert("conversations", {
        pairKey: pairKey(alice.userId, bob.userId),
        participantIds: [alice.userId, bob.userId],
        lastMessageAt: now,
        lastMessageBody: "",
      });
      for (const userId of [alice.userId, bob.userId]) {
        await ctx.db.insert("conversationMembers", {
          conversationId: extra,
          userId,
          lastActivityAt: now,
          unreadCount: 0,
        });
      }
    });
    const opened = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    const thread = await alice.as.query(api.messages.list, {
      conversationId: opened, paginationOpts: firstPage,
    });
    expect(thread.page.map((m: any) => m.body)).toContain("keep me");
  });
});

describe("pair collapse", () => {
  it("duplicate friendships do not throw; accepted wins", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    await t.run(async (ctx) => {
      await ctx.db.insert("friendships", {
        requesterId: alice.userId,
        addresseeId: bob.userId,
        status: "pending",
        pairKey: pairKey(alice.userId, bob.userId),
        createdAt: Date.now(),
      });
    });
    const list = await alice.as.query(api.friends.list, {});
    expect(list.some((f: any) => f.userId === bob.userId)).toBe(true);
    await alice.as.mutation(api.friends.unfriend, { userId: bob.userId });
    expect(await alice.as.query(api.friends.list, {})).toEqual([]);
  });
});
