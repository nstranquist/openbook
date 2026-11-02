import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

const zeroReactions = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };

describe("production migrations", () => {
  it("rejects a counter reset in production", async () => {
    const t = convexTest(schema, modules);
    const previous = process.env.OPENBOOK_ENV;
    process.env.OPENBOOK_ENV = "production";
    try {
      await expect(
        t.mutation(internal.migrations.startUserStats, { reset: true }),
      ).rejects.toThrow(/cannot be reset/i);
    } finally {
      if (previous === undefined) delete process.env.OPENBOOK_ENV;
      else process.env.OPENBOOK_ENV = previous;
    }
  });

  it("rebuilds exact counters in resumable bounded pages", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await t.run(async (ctx) => {
      const now = Date.now();
      const alice = await ctx.db.insert("users", { email: "alice@example.test" });
      const bob = await ctx.db.insert("users", { email: "bob@example.test" });
      for (const [userId, displayName] of [[alice, "Alice"], [bob, "Bob"]] as const) {
        await ctx.db.insert("profiles", {
          userId,
          displayName,
          avatarHue: 1,
          coverHue: 2,
          joinedAt: now,
        });
        await ctx.db.insert("userStats", {
          userId,
          postCount: 999,
          notificationUnreadCount: 999,
          messageUnreadCount: 999,
          friendCount: 999,
          storageBytes: 999,
          uploadCount: 999,
          postCountExact: true,
          notificationUnreadCountExact: true,
          messageUnreadCountExact: true,
          friendCountExact: true,
          storageBytesExact: true,
          uploadCountExact: true,
          updatedAt: now,
        });
      }
      await ctx.db.insert("posts", {
        authorId: alice,
        body: "active",
        audience: "public",
        createdAt: now,
        commentCount: 0,
        reactionCounts: zeroReactions,
      });
      await ctx.db.insert("posts", {
        authorId: alice,
        body: "",
        audience: "public",
        createdAt: now + 1,
        commentCount: 0,
        reactionCounts: zeroReactions,
        deletedAt: now + 2,
      });
      await ctx.db.insert("notifications", {
        userId: alice,
        actorId: bob,
        kind: "friend_request",
        read: false,
        createdAt: now,
      });
      await ctx.db.insert("notifications", {
        userId: alice,
        actorId: bob,
        kind: "friend_accept",
        read: true,
        createdAt: now + 1,
      });
      const conversationId = await ctx.db.insert("conversations", {
        pairKey: `${alice}:${bob}`,
        participantIds: [alice, bob],
        lastMessageAt: now,
        lastMessageBody: "hello",
      });
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId: alice,
        lastActivityAt: now,
        unreadCount: 7,
      });
      await ctx.db.insert("friendships", {
        requesterId: alice,
        addresseeId: bob,
        status: "accepted",
        pairKey: `${alice}:${bob}`,
        createdAt: now,
        respondedAt: now,
      });
      await ctx.db.insert("friendships", {
        requesterId: bob,
        addresseeId: alice,
        status: "accepted",
        pairKey: `${alice}:${bob}`,
        createdAt: now + 1,
        respondedAt: now + 1,
      });
      return { alice, bob };
    });

    vi.useFakeTimers();
    try {
      await t.mutation(internal.migrations.startUserStats, { reset: true });
      await t.finishAllScheduledFunctions(vi.runAllTimers, 100);
    } finally {
      vi.useRealTimers();
    }

    expect(await t.query(internal.migrations.userStatsStatus, {})).toEqual({
      status: "complete",
      phase: "complete",
      processed: 11,
    });
    await t.run(async (ctx) => {
      const aliceStats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", alice))
        .unique();
      const bobStats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", bob))
        .unique();
      const friendEdges = await ctx.db.query("friendEdges").collect();
      expect(aliceStats).toMatchObject({
        postCount: 1,
        notificationUnreadCount: 1,
        messageUnreadCount: 7,
        friendCount: 1,
        storageBytes: 0,
        uploadCount: 0,
        postCountExact: true,
        notificationUnreadCountExact: true,
        messageUnreadCountExact: true,
        friendCountExact: true,
        storageBytesExact: true,
        uploadCountExact: true,
      });
      expect(bobStats).toMatchObject({
        postCount: 0,
        notificationUnreadCount: 0,
        messageUnreadCount: 0,
        friendCount: 1,
        storageBytes: 0,
        uploadCount: 0,
      });
      expect(friendEdges).toHaveLength(2);
      expect(friendEdges.map((edge) => `${edge.userId}:${edge.friendId}`).sort()).toEqual(
        [`${alice}:${bob}`, `${bob}:${alice}`].sort(),
      );
      expect((await ctx.db.query("friendships").collect())).toHaveLength(1);
    });
  });
});
