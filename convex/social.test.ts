import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { modules } from "./test.setup";
import { pairKey } from "./lib/social";
import { registerOwnedUpload } from "./lib/uploads";

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

describe("albums", () => {
  it("creates an album for the owner", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const id = await alice.as.mutation(api.albums.create, { title: "Trip" });
    const list = await alice.as.query(api.albums.listMine, { userId: alice.userId });
    expect(list).toHaveLength(1);
    expect(list[0]._id).toBe(id);
    expect(list[0].title).toBe("Trip");
    const page = await alice.as.query(api.albums.listPage, {
      userId: alice.userId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page.page[0]._id).toBe(id);
  });

  it("adds a registered owned photo and updates the exact album count", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const albumId = await alice.as.mutation(api.albums.create, { title: "Trip" });
    const imageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      );
      // convex-test omits Blob.type from its synthetic _storage metadata.
      await (ctx.db as any).patch(id, { contentType: "image/png" });
      return id;
    });
    await t.run(async (ctx) => registerOwnedUpload(ctx, alice.userId, imageId));
    await alice.as.mutation(api.albums.addPhoto, { albumId, imageId });
    const page = await alice.as.query(api.albums.listPage, {
      userId: alice.userId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page.page[0]).toMatchObject({ _id: albumId, itemCount: 1 });
    await t.run(async (ctx) => {
      const upload = await ctx.db
        .query("uploads")
        .withIndex("by_storage", (q) => q.eq("storageId", imageId))
        .unique();
      expect(upload).toMatchObject({ userId: alice.userId, used: true, size: 3 });
    });
  });

  it("bounds active upload grants and binds registration to kind and byte size", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const grants = [];
    for (let index = 0; index < 4; index += 1) {
      grants.push(await alice.as.mutation(api.posts.generateUploadUrl, {
        kind: "image",
        declaredBytes: 3,
      }));
    }
    await expect(alice.as.mutation(api.posts.generateUploadUrl, {
      kind: "image",
      declaredBytes: 3,
    })).rejects.toThrow(/active uploads/i);

    const imageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1, 2])], { type: "image/png" })),
    );
    await expect(alice.as.mutation(api.posts.registerImage, {
      storageId: imageId,
      grantId: grants[0].grantId,
    })).rejects.toThrow(/size does not match/i);
    await expect(alice.as.mutation(api.posts.registerVideo, {
      storageId: imageId,
      grantId: grants[0].grantId,
    })).rejects.toThrow(/grant not found/i);
  });
});

describe("profiles", () => {
  it("requires profile provisioning before an authenticated write", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t, "unprovisioned@example.test");
    const as = t.withIdentity({ subject: userId });
    await expect(
      as.mutation(api.posts.create, { body: "too early", audience: "public" }),
    ).rejects.toThrow(/profile first/i);
  });

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

  it("rejects an oversized display name during initial provisioning", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t, "long-name@example.test");
    const as = t.withIdentity({ subject: userId });
    await expect(
      as.mutation(api.profiles.ensure, { displayName: "x".repeat(81) }),
    ).rejects.toThrow(/too long/i);
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

describe("production trust boundaries", () => {
  it("stops cross-user state creation for a closed account but permits cleanup", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await alice.as.mutation(api.blocks.set, { userId: bob.userId, blocked: true });
    await alice.as.mutation(api.mutes.set, { userId: bob.userId, muted: true });
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", bob.userId))
        .unique();
      await ctx.db.patch(profile!._id, { deletedAt: Date.now() });
    });
    await alice.as.mutation(api.blocks.set, { userId: bob.userId, blocked: false });
    await alice.as.mutation(api.mutes.set, { userId: bob.userId, muted: false });
    await expect(
      alice.as.mutation(api.blocks.set, { userId: bob.userId, blocked: true }),
    ).rejects.toThrow(/user not found/i);
    await expect(
      alice.as.mutation(api.mutes.set, { userId: bob.userId, muted: true }),
    ).rejects.toThrow(/user not found/i);
  });

  it("validates moderation targets and deduplicates open reports", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const carol = await actor(t, "Carol");
    const postId = await bob.as.mutation(api.posts.create, {
      body: "Reportable",
      audience: "public",
    });
    const first = await alice.as.mutation(api.reports.create, {
      postId,
      reason: "Abuse",
    });
    const duplicate = await alice.as.mutation(api.reports.create, {
      postId,
      reason: "Duplicate",
    });
    expect(duplicate).toBe(first);
    await expect(
      alice.as.mutation(api.reports.create, {
        postId,
        targetUserId: carol.userId,
        reason: "Mismatch",
      }),
    ).rejects.toThrow(/does not match/i);
    await expect(
      alice.as.mutation(api.reports.create, {
        targetUserId: alice.userId,
        reason: "Self",
      }),
    ).rejects.toThrow(/yourself/i);
  });

  it("uses the event start index instead of exhausting the page on old events", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const futureId = await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 45; index += 1) {
        await ctx.db.insert("events", {
          title: `Past ${index}`,
          description: "",
          startAt: now - 7_200_000 - index,
          hostId: alice.userId,
          createdAt: now - index,
          goingCount: 1,
          interestedCount: 0,
        });
      }
      return await ctx.db.insert("events", {
        title: "Future",
        description: "",
        startAt: now + 3_600_000,
        hostId: alice.userId,
        createdAt: now,
        goingCount: 1,
        interestedCount: 0,
      });
    });
    const upcoming = await alice.as.query(api.events.upcoming, {});
    expect(upcoming.map((event: any) => event._id)).toContain(futureId);
  });

  it("paginates past private group events without exposing them", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const anchorAt = Date.now();
    const publicId = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("groups", {
        name: "Private",
        description: "",
        kind: "group",
        creatorId: alice.userId,
        createdAt: anchorAt,
        memberCount: 1,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: alice.userId,
        role: "owner",
        createdAt: anchorAt,
      });
      for (let index = 0; index < 55; index += 1) {
        await ctx.db.insert("events", {
          title: `Private ${index}`,
          description: "",
          startAt: anchorAt + 60_000 + index,
          hostId: alice.userId,
          groupId,
          createdAt: anchorAt,
        });
      }
      return await ctx.db.insert("events", {
        title: "Public after private pages",
        description: "",
        startAt: anchorAt + 120_000,
        hostId: alice.userId,
        createdAt: anchorAt,
      });
    });

    let cursor: string | null = null;
    let done = false;
    const visible: string[] = [];
    for (let page = 0; page < 5 && !done; page += 1) {
      const result = await bob.as.query(api.events.upcomingPage, {
        anchorAt,
        paginationOpts: { numItems: 20, cursor },
      });
      visible.push(...result.page.map((event: any) => event._id));
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(visible).toEqual([publicId]);
    expect(done).toBe(true);
  });

  it("revokes authenticated application reads as soon as the profile closes", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    await alice.as.mutation(api.posts.create, { body: "Before close", audience: "public" });
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", alice.userId))
        .unique();
      await ctx.db.patch(profile!._id, { deletedAt: Date.now() });
    });
    expect((await alice.as.query(api.posts.feed, { paginationOpts: firstPage })).page).toEqual([]);
    expect(await alice.as.query(api.notifications.list, {})).toEqual([]);
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
    expect(await bob.as.query(api.notifications.unreadCount, {})).toBe(1);

    await bob.as.mutation(api.friends.accept, { userId: alice.userId });
    const aliceFriends = await alice.as.query(api.friends.list, {});
    const bobFriends = await bob.as.query(api.friends.list, {});
    expect(aliceFriends.map((c: any) => c.userId)).toContain(bob.userId);
    expect(bobFriends.map((c: any) => c.userId)).toContain(alice.userId);
    expect(await alice.as.query(api.friends.count, {})).toBe(1);
    expect(await bob.as.query(api.friends.count, {})).toBe(1);

    expect(await bob.as.query(api.notifications.unreadCount, {})).toBe(0);
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
    expect(await alice.as.query(api.friends.count, {})).toBe(1);
    expect(await bob.as.query(api.friends.count, {})).toBe(1);
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
    expect(await alice.as.query(api.friends.count, {})).toBe(0);
    expect(await bob.as.query(api.friends.count, {})).toBe(0);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("friendEdges").collect()).toEqual([]);
    });
  });

  it("paginates both directions of a large friend list without gaps or duplicates", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const others = await Promise.all(
      Array.from({ length: 7 }, (_, index) => actor(t, `Friend ${index}`)),
    );
    for (const [index, other] of others.entries()) {
      if (index % 2 === 0) await befriend(alice, other);
      else await befriend(other, alice);
    }

    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await alice.as.query(api.friends.listPage, {
        paginationOpts: { numItems: 2, cursor },
      });
      ids.push(...page.page.map((friend: any) => String(friend.userId)));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(new Set(ids)).toEqual(new Set(others.map((other) => String(other.userId))));
    expect(ids).toHaveLength(others.length);
    expect(await alice.as.query(api.friends.count, {})).toBe(others.length);
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

  it("profile pagination crosses the bounded scan window without gaps or loops", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    await t.run(async (ctx) => {
      const createdAt = Date.now();
      for (let index = 0; index < 105; index += 1) {
        await ctx.db.insert("posts", {
          authorId: alice.userId,
          body: `post-${index}`,
          audience: "public",
          createdAt,
          commentCount: 0,
          reactionCounts: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
        });
      }
    });
    const ids = new Set<string>();
    let cursor: string | null = null;
    let done = false;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const result = await alice.as.query(api.posts.forProfile, {
        userId: alice.userId,
        paginationOpts: { numItems: 20, cursor },
      });
      expect(result.page.length > 0 || result.isDone).toBe(true);
      for (const post of result.page) ids.add(post._id);
      if (result.isDone) {
        done = true;
        break;
      }
      expect(result.continueCursor).not.toBe("");
      cursor = result.continueCursor;
    }
    expect(done).toBe(true);
    expect(ids.size).toBe(105);
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
    vi.useFakeTimers();
    await alice.as.mutation(api.posts.remove, { id: postId });

    // The tombstone hides the post before bounded physical cleanup finishes.
    expect(await bob.as.query(api.posts.get, { id: postId })).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

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

    const comments = await alice.as.query(api.comments.list, { postId, paginationOpts: firstPage });
    expect(comments.page).toHaveLength(1);
    expect(comments.page[0].author.displayName).toBe("Carol");
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
    expect((await bob.as.query(api.comments.list, { postId, paginationOpts: firstPage })).page).toHaveLength(1);

    await alice.as.mutation(api.friends.unfriend, { userId: bob.userId });
    expect((await bob.as.query(api.comments.list, { postId, paginationOpts: firstPage })).page).toEqual([]);
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

  it("markAllRead preserves notifications that arrive between batches", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const cutoff = 1_800_000_000_000;

    await t.run(async (ctx) => {
      for (let index = 0; index < 105; index += 1) {
        await ctx.db.insert("notifications", {
          userId: alice.userId,
          actorId: bob.userId,
          kind: "friend_accept",
          read: false,
          createdAt: cutoff - 1,
        });
      }
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", alice.userId))
        .unique();
      if (!stats) throw new Error("Missing user statistics");
      await ctx.db.patch(stats._id, { notificationUnreadCount: 105 });
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(cutoff);
      await alice.as.mutation(api.notifications.markAllRead, {});
      vi.setSystemTime(cutoff + 1);
      await t.run(async (ctx) => {
        await ctx.db.insert("notifications", {
          userId: alice.userId,
          actorId: bob.userId,
          kind: "friend_accept",
          read: false,
          createdAt: cutoff + 1,
        });
        const stats = await ctx.db
          .query("userStats")
          .withIndex("by_user", (q) => q.eq("userId", alice.userId))
          .unique();
        if (!stats) throw new Error("Missing user statistics");
        await ctx.db.patch(stats._id, {
          notificationUnreadCount: stats.notificationUnreadCount + 1,
        });
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(1);
    await t.run(async (ctx) => {
      const unread = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", alice.userId).eq("read", false))
        .collect();
      expect(unread).toHaveLength(1);
      expect(unread[0].createdAt).toBe(cutoff + 1);
    });
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
    const bobPage = await bob.as.query(api.messages.myConversationsPage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(bobPage.page[0].conversationId).toBe(conv1);
    expect((await bob.as.query(api.messages.conversationSummary, {
      conversationId: conv1,
    }))?.unreadCount).toBe(2);

    await bob.as.mutation(api.messages.markRead, { conversationId: conv1 });
    expect(await bob.as.query(api.messages.unreadTotal, {})).toBe(0);

    const thread = await bob.as.query(api.messages.list, {
      conversationId: conv1, paginationOpts: firstPage,
    });
    // Newest-first pagination; isMine is viewer-relative.
    expect(thread.page.map((m: any) => m.body)).toEqual(["you there?", "hey Bob"]);
    expect(thread.page[0].isMine).toBe(false);
  });

  it("paginates the complete conversation list without a fixed cutoff", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const expected = new Set<string>();
    for (let index = 0; index < 7; index += 1) {
      const peer = await actor(t, `Peer ${index}`);
      await befriend(alice, peer);
      expected.add(String(await alice.as.mutation(api.messages.open, { userId: peer.userId })));
    }

    const actual: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await alice.as.query(api.messages.myConversationsPage, {
        paginationOpts: { numItems: 2, cursor },
      });
      actual.push(...page.page.map((row: any) => String(row.conversationId)));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(new Set(actual)).toEqual(expected);
    expect(actual).toHaveLength(7);
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

  it("sender can delete their message and preview rewinds", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const conv = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await alice.as.mutation(api.messages.send, { conversationId: conv, body: "first" });
    await alice.as.mutation(api.messages.send, { conversationId: conv, body: "second" });
    const thread = await alice.as.query(api.messages.list, {
      conversationId: conv, paginationOpts: firstPage,
    });
    const second = thread.page.find((m: any) => m.body === "second");
    await alice.as.mutation(api.messages.remove, { id: second._id });
    const after = await alice.as.query(api.messages.list, {
      conversationId: conv, paginationOpts: firstPage,
    });
    expect(after.page.map((m: any) => m.body)).toEqual(["first"]);
    const convs = await alice.as.query(api.messages.myConversations, {});
    expect(convs[0].lastMessageBody).toBe("first");
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

describe("privacy, reports, stories, events, search", () => {
  it("friends-only bio is hidden from strangers", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    await alice.as.mutation(api.profiles.update, {
      bio: "secret bio",
      bioAudience: "friends",
    });
    const view = await mallory.as.query(api.profiles.view, { userId: alice.userId });
    expect(view?.bio).toBeUndefined();
  });

  it("hidden friends list is empty for non-friends", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    await befriend(alice, bob);
    await alice.as.mutation(api.profiles.update, { friendsListPublic: false });
    expect(await mallory.as.query(api.friends.list, { userId: alice.userId })).toEqual([]);
    expect((await bob.as.query(api.friends.list, { userId: alice.userId })).map((f: any) => f.userId)).toContain(bob.userId);
  });

  it("message edit stamps editedAt; hide drops the thread from my list", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const conv = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await alice.as.mutation(api.messages.send, { conversationId: conv, body: "draft" });
    const thread = await alice.as.query(api.messages.list, {
      conversationId: conv, paginationOpts: firstPage,
    });
    await alice.as.mutation(api.messages.edit, { id: thread.page[0]._id, body: "edited" });
    const after = await alice.as.query(api.messages.list, {
      conversationId: conv, paginationOpts: firstPage,
    });
    expect(after.page[0].body).toBe("edited");
    expect(after.page[0].editedAt).toBeTruthy();
    expect((await bob.as.query(api.messages.myConversations, {}))[0].lastMessageBody).toBe(
      "edited",
    );
    await expect(
      alice.as.mutation(api.messages.edit, {
        id: thread.page[0]._id,
        body: "x".repeat(4001),
      }),
    ).rejects.toThrow(/too long/i);
    await alice.as.mutation(api.messages.hide, { conversationId: conv });
    expect(await alice.as.query(api.messages.myConversations, {})).toEqual([]);
    await bob.as.mutation(api.messages.send, { conversationId: conv, body: "ping" });
    expect((await alice.as.query(api.messages.myConversations, {})).map((c: any) => c.conversationId)).toContain(conv);
  });

  it("stories expire from the feed after 24h and honor audience", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    await befriend(alice, bob);
    const id = await alice.as.mutation(api.stories.create, {
      body: "hi friends", audience: "friends",
    });
    expect((await bob.as.query(api.stories.feed, {})).some((s: any) => s._id === id)).toBe(true);
    expect((await mallory.as.query(api.stories.feed, {})).some((s: any) => s._id === id)).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { expiresAt: Date.now() - 1 });
    });
    expect((await bob.as.query(api.stories.feed, {})).some((s: any) => s._id === id)).toBe(false);
  });

  it("event host is going; others can RSVP interested", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const eventId = await alice.as.mutation(api.events.create, {
      title: "Picnic", description: "park", startAt: Date.now() + 60_000,
    });
    await bob.as.mutation(api.events.rsvp, { eventId, status: "interested" });
    const list = await bob.as.query(api.events.upcoming, {});
    const row = list.find((e: any) => e._id === eventId);
    expect(row?.going).toBe(1);
    expect(row?.interested).toBe(1);
    expect(row?.myRsvp).toBe("interested");
  });

  it("keeps group events private to current members", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const groupId = await alice.as.mutation(api.groups.create, {
      name: "Private club",
      description: "",
      kind: "group",
    });
    const eventId = await alice.as.mutation(api.events.create, {
      title: "Members only",
      description: "",
      startAt: Date.now() + 60_000,
      groupId,
    });
    expect((await bob.as.query(api.events.upcoming, {})).map((event: any) => event._id)).not.toContain(
      eventId,
    );
    await expect(
      bob.as.mutation(api.events.rsvp, { eventId, status: "interested" }),
    ).rejects.toThrow(/not found/i);
    await bob.as.mutation(api.groups.join, { groupId });
    expect((await bob.as.query(api.events.upcoming, {})).map((event: any) => event._id)).toContain(
      eventId,
    );
  });

  it("reports can be withdrawn by the reporter", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const id = await alice.as.mutation(api.reports.create, {
      targetUserId: bob.userId, reason: "spam",
    });
    await alice.as.mutation(api.reports.withdraw, { id });
    const mine = await alice.as.query(api.reports.mine, {});
    expect(mine[0].status).toBe("closed");
  });

  it("operator can review the queue when OPERATOR_USER_IDS matches", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const previous = process.env.OPERATOR_USER_IDS;
    process.env.OPERATOR_USER_IDS = alice.userId;
    try {
      const id = await bob.as.mutation(api.reports.create, {
        targetUserId: alice.userId, reason: "abuse",
      });
      const queue = await alice.as.query(api.reports.queue, {});
      expect(queue.some((r: any) => r._id === id)).toBe(true);
      const queuePage = await alice.as.query(api.reports.queuePage, {
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(queuePage.page.some((report: any) => report._id === id)).toBe(true);
      await alice.as.mutation(api.reports.review, { id, status: "closed" });
      expect(await alice.as.query(api.reports.queue, {})).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.OPERATOR_USER_IDS;
      else process.env.OPERATOR_USER_IDS = previous;
    }
  });

  it("post search respects friends-only visibility", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const mallory = await actor(t, "Mallory");
    await alice.as.mutation(api.posts.create, {
      body: "unique-search-token-friends", audience: "friends",
    });
    expect(await mallory.as.query(api.posts.search, { q: "unique-search-token-friends" })).toEqual([]);
    expect(
      (await alice.as.query(api.posts.search, { q: "unique-search-token-friends" })).map((p: any) => p.body),
    ).toContain("unique-search-token-friends");
  });

  it("group posts are members-only", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    const groupId = await alice.as.mutation(api.groups.create, {
      name: "Private club", description: "", kind: "group",
    });
    await bob.as.mutation(api.groups.join, { groupId });
    const postId = await alice.as.mutation(api.posts.create, {
      body: "club only", audience: "public", groupId,
    });
    expect(await bob.as.query(api.posts.get, { id: postId })).not.toBeNull();
    expect(await mallory.as.query(api.posts.get, { id: postId })).toBeNull();
  });

  it("discover lists groups the viewer has not joined", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const groupId = await alice.as.mutation(api.groups.create, {
      name: "Open club", description: "", kind: "group",
    });
    const found = await bob.as.query(api.groups.discover, {});
    expect(found.some((g: any) => g._id === groupId)).toBe(true);
    expect(await alice.as.query(api.groups.discover, {})).toEqual([]);
  });
});

describe("comment edit", () => {
  it("author can edit a comment", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "with comments", audience: "public",
    });
    const id = await alice.as.mutation(api.comments.add, { postId, body: "draft" });
    await alice.as.mutation(api.comments.edit, { id, body: "edited comment" });
    const page = await alice.as.query(api.comments.list, { postId, paginationOpts: firstPage });
    expect(page.page[0].body).toBe("edited comment");
    expect(page.page[0].editedAt).toBeTruthy();
  });
});

describe("message search and push config", () => {
  it("message search is scoped to the viewer's threads", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    await befriend(alice, bob);
    const conv = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await alice.as.mutation(api.messages.send, {
      conversationId: conv, body: "unique-dm-token-xyz",
    });
    expect(
      (await alice.as.query(api.messages.search, { q: "unique-dm-token-xyz" })).map((m: any) => m.body),
    ).toContain("unique-dm-token-xyz");
    expect(await mallory.as.query(api.messages.search, { q: "unique-dm-token-xyz" })).toEqual([]);
  });

  it("vapidPublicKey is null when unset; http endpoints are refused", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    expect(await alice.as.query(api.push.vapidPublicKey, {})).toBeNull();
    await expect(
      alice.as.mutation(api.push.subscribe, {
        endpoint: "http://example.test/push",
        p256dh: "x",
        auth: "y",
      }),
    ).rejects.toThrow(/invalid push endpoint/i);
  });
});

describe("mute and groups", () => {
  it("mute hides public posts from the muter's feed only", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "loud", audience: "public",
    });
    await bob.as.mutation(api.mutes.set, { userId: alice.userId, muted: true });
    const mutedPage = await bob.as.query(api.mutes.listPage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(mutedPage.page[0].userId).toBe(alice.userId);
    const feed = await bob.as.query(api.posts.feed, { paginationOpts: firstPage });
    expect(feed.page.map((p: any) => p._id)).not.toContain(postId);
    expect(await bob.as.query(api.posts.get, { id: postId })).not.toBeNull();
  });

  it("group create makes the creator an owner", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const id = await alice.as.mutation(api.groups.create, {
      name: "Book club", description: "", kind: "group",
    });
    const list = await alice.as.query(api.groups.list, {});
    expect(list.some((g: any) => g._id === id && g.role === "owner")).toBe(true);
    const page = await alice.as.query(api.groups.listPage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page.page.some((group: any) => group._id === id && group.role === "owner")).toBe(true);
  });
});

describe("blocks", () => {
  it("hides posts and rejects friend requests in both directions", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const postId = await alice.as.mutation(api.posts.create, {
      body: "hello bob", audience: "public",
    });
    expect(await bob.as.query(api.posts.get, { id: postId })).not.toBeNull();
    await alice.as.mutation(api.blocks.set, { userId: bob.userId, blocked: true });
    const blockedPage = await alice.as.query(api.blocks.listPage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(blockedPage.page[0].userId).toBe(bob.userId);
    expect(await alice.as.query(api.friends.list, {})).toEqual([]);
    expect(await alice.as.query(api.friends.count, {})).toBe(0);
    expect(await bob.as.query(api.friends.count, {})).toBe(0);
    expect(await bob.as.query(api.posts.get, { id: postId })).toBeNull();
    await expect(
      bob.as.mutation(api.friends.sendRequest, { userId: alice.userId }),
    ).rejects.toThrow(/cannot send/i);
    await alice.as.mutation(api.blocks.set, { userId: bob.userId, blocked: false });
    expect(await bob.as.query(api.posts.get, { id: postId })).not.toBeNull();
  });
});

describe("post edit and account close", () => {
  it("author can edit body and audience", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "draft", audience: "friends",
    });
    await alice.as.mutation(api.posts.update, {
      id: postId, body: "published", audience: "public",
    });
    const got = await alice.as.query(api.posts.get, { id: postId });
    expect(got?.body).toBe("published");
    expect(got?.audience).toBe("public");
    expect(got?.editedAt).toBeTruthy();
  });

  it("allows an attached-video post to keep an empty text body", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const postId = await t.run(async (ctx) => {
      const videoId = await ctx.storage.store(new Blob([new Uint8Array([1])]));
      return await ctx.db.insert("posts", {
        authorId: alice.userId,
        body: "caption",
        audience: "public",
        videoId,
        createdAt: Date.now(),
        commentCount: 0,
        reactionCounts: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
      });
    });
    await alice.as.mutation(api.posts.update, { id: postId, body: "" });
    expect((await alice.as.query(api.posts.get, { id: postId }))?.body).toBe("");
  });

  it("deleteAccount hides the profile and posts", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "gone soon", audience: "public",
    });
    await alice.as.mutation(api.profiles.deleteAccount, {});
    expect(await bob.as.query(api.profiles.view, { userId: alice.userId })).toBeNull();
    expect(await bob.as.query(api.posts.get, { id: postId })).toBeNull();
    await expect(
      bob.as.mutation(api.friends.sendRequest, { userId: alice.userId }),
    ).rejects.toThrow(/user not found/i);
    await expect(
      alice.as.mutation(api.posts.create, { body: "still here", audience: "public" }),
    ).rejects.toThrow(/closed/i);
  });

  it("stops new messages to an account as soon as it closes", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const conversationId = await alice.as.mutation(api.messages.open, { userId: bob.userId });
    await bob.as.mutation(api.profiles.deleteAccount, {});
    await expect(
      alice.as.mutation(api.messages.send, { conversationId, body: "too late" }),
    ).rejects.toThrow(/user not found/i);
  });
});

describe("friend notification cleanup", () => {
  it("decline removes the friend_request notification", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await bob.as.mutation(api.friends.sendRequest, { userId: alice.userId });
    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(1);
    await alice.as.mutation(api.friends.decline, { userId: bob.userId });
    expect(await alice.as.query(api.notifications.unreadCount, {})).toBe(0);
  });
});

describe("saved posts", () => {
  it("keeps a private, visibility-filtered reading list", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const mallory = await actor(t, "Mallory");
    const publicPost = await alice.as.mutation(api.posts.create, {
      body: "save this", audience: "public",
    });
    const friendsPost = await alice.as.mutation(api.posts.create, {
      body: "friends only", audience: "friends",
    });

    expect((await bob.as.query(api.posts.get, { id: publicPost }))?.isSaved).toBe(false);
    expect(await bob.as.mutation(api.saved.toggle, { postId: publicPost })).toBe(true);
    expect((await bob.as.query(api.posts.get, { id: publicPost }))?.isSaved).toBe(true);
    const bobSaved = await bob.as.query(api.saved.list, { paginationOpts: firstPage });
    expect(bobSaved.page.map((post: any) => post._id)).toEqual([publicPost]);
    expect((await alice.as.query(api.saved.list, { paginationOpts: firstPage })).page).toEqual([]);
    await expect(
      mallory.as.mutation(api.saved.toggle, { postId: friendsPost }),
    ).rejects.toThrow(/post not found/i);

    expect(await bob.as.mutation(api.saved.toggle, { postId: publicPost })).toBe(false);
    expect((await bob.as.query(api.saved.list, { paginationOpts: firstPage })).page).toEqual([]);
  });

  it("removes saved rows when their post is deleted", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    const postId = await alice.as.mutation(api.posts.create, {
      body: "temporary", audience: "public",
    });
    await bob.as.mutation(api.saved.toggle, { postId });
    vi.useFakeTimers();
    await alice.as.mutation(api.posts.remove, { id: postId });
    expect((await bob.as.query(api.saved.list, { paginationOpts: firstPage })).page).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const rows = await t.run(async (ctx) => ctx.db.query("savedPosts").collect());
    expect(rows).toEqual([]);
  });
});

describe("account deletion", () => {
  it("tombstones immediately and drains large user data in bounded batches", async () => {
    const t = convexTest(schema, modules);
    const alice = await actor(t, "Alice");
    const bob = await actor(t, "Bob");
    await befriend(alice, bob);
    const postId = await alice.as.mutation(api.posts.create, {
      body: "remove my data",
      audience: "public",
    });

    await t.run(async (ctx) => {
      const now = Date.now();
      const conversationId = await ctx.db.insert("conversations", {
        pairKey: pairKey(alice.userId, bob.userId),
        participantIds: [alice.userId, bob.userId],
        lastMessageAt: now,
        lastMessageBody: "private",
        lastSenderId: alice.userId,
      });
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId: alice.userId,
        lastActivityAt: now,
        unreadCount: 0,
      });
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId: bob.userId,
        lastActivityAt: now,
        unreadCount: 105,
      });
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("messages", {
          conversationId,
          senderId: alice.userId,
          body: `private ${i}`,
          createdAt: now + i,
        });
        await ctx.db.insert("savedPosts", {
          userId: alice.userId,
          postId,
          createdAt: now + i,
        });
      }
      const sessionId = await ctx.db.insert("authSessions", {
        userId: alice.userId,
        expirationTime: now + 60_000,
      });
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId,
          expirationTime: now + 60_000,
        });
      }
      await ctx.db.insert("authVerifiers", {
        sessionId,
        signature: "private-verifier",
      });
      await ctx.db.insert("authRateLimits", {
        identifier: "alice@example.test",
        lastAttemptTime: now,
        attemptsLeft: 1,
      });
      await ctx.db.insert("conversationTyping", {
        conversationId,
        userId: alice.userId,
        updatedAt: now,
      });
      await ctx.db.insert("uploadGrants", {
        userId: alice.userId,
        kind: "image",
        declaredBytes: 3,
        active: true,
        createdAt: now,
      });
      await ctx.db.insert("reports", {
        reporterId: bob.userId,
        targetUserId: alice.userId,
        reason: "retain the moderation evidence",
        status: "open",
        createdAt: now,
      });
      const baseDelivery = {
        subjectUserId: alice.userId,
        state: "pending" as const,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.db.insert("deliveryJobs", {
        ...baseDelivery,
        dedupeKey: "delete-email",
        payload: {
          kind: "email",
          to: "alice@example.test",
          subject: "Queued email",
        },
      });
      await ctx.db.insert("deliveryJobs", {
        ...baseDelivery,
        dedupeKey: "delete-push",
        payload: {
          kind: "push",
          userId: alice.userId,
          title: "Queued push",
          body: "Private notification",
        },
      });
      await ctx.db.insert("deliveryJobs", {
        ...baseDelivery,
        dedupeKey: "delete-stripe",
        payload: {
          kind: "stripe_cancel",
          stripeSubscriptionId: "sub_delete",
        },
      });
    });

    vi.useFakeTimers();
    try {
      await alice.as.mutation(api.profiles.deleteAccount, {});
      expect(await bob.as.query(api.profiles.view, { userId: alice.userId })).toBeNull();
      expect(await bob.as.query(api.posts.get, { id: postId })).toBeNull();
      await t.finishAllScheduledFunctions(vi.runAllTimers, 500);
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", alice.userId))
        .unique();
      const user = await ctx.db.get(alice.userId);
      const job = await ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_user", (q) => q.eq("userId", alice.userId))
        .unique();
      expect(profile?.displayName).toBe("Deleted account");
      expect(profile?.deletedAt).toBeTypeOf("number");
      expect(user?.email).toBeUndefined();
      expect(job?.phase).toBe("complete");
      expect(job?.completedAt).toBeTypeOf("number");
      expect(await ctx.db.query("messages").withIndex("by_sender", (q) => q.eq("senderId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("savedPosts").withIndex("by_user_created", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("authVerifiers").withIndex("signature", (q) => q.eq("signature", "private-verifier")).collect()).toEqual([]);
      expect(await ctx.db.query("authRateLimits").withIndex("identifier", (q) => q.eq("identifier", "alice@example.test")).collect()).toEqual([]);
      expect(await ctx.db.query("conversationTyping").withIndex("by_user", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("pairLocks").withIndex("by_user_a", (q) => q.eq("userA", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("pairLocks").withIndex("by_user_b", (q) => q.eq("userB", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("userStats").withIndex("by_user", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("uploadGrants").withIndex("by_user", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("friendEdges").withIndex("by_user_created", (q) => q.eq("userId", alice.userId)).collect()).toEqual([]);
      expect(await ctx.db.query("friendEdges").withIndex("by_friend", (q) => q.eq("friendId", alice.userId)).collect()).toEqual([]);
      const bobStats = await ctx.db.query("userStats").withIndex("by_user", (q) => q.eq("userId", bob.userId)).unique();
      expect(bobStats?.friendCount).toBe(0);
      const targetedReports = await ctx.db.query("reports").withIndex("by_target_user", (q) => q.eq("targetUserId", alice.userId)).collect();
      expect(targetedReports).toEqual([]);
      const deliveries = await ctx.db.query("deliveryJobs").collect();
      expect(deliveries.map((row) => row.dedupeKey)).not.toContain("delete-email");
      expect(deliveries.map((row) => row.dedupeKey)).not.toContain("delete-push");
      const stripeCancellation = deliveries.find((row) => row.dedupeKey === "delete-stripe");
      expect(stripeCancellation).toBeDefined();
      expect(stripeCancellation?.subjectUserId).toBeUndefined();
      expect(await ctx.db.get(postId)).toBeNull();
    });
  });
});
