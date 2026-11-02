import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

const zeroReactions = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };

describe("link preview application", () => {
  it("rejects stale work and accounts for proxied preview images", async () => {
    const t = convexTest(schema, modules);
    const { userId, postId, firstImageId, secondImageId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "preview@example.test" });
      await ctx.db.insert("profiles", {
        userId,
        displayName: "Preview Test",
        avatarHue: 1,
        coverHue: 2,
        joinedAt: Date.now(),
      });
      await ctx.db.insert("userStats", {
        userId,
        postCount: 1,
        notificationUnreadCount: 0,
        messageUnreadCount: 0,
        storageBytes: 0,
        uploadCount: 0,
        postCountExact: true,
        notificationUnreadCountExact: true,
        messageUnreadCountExact: true,
        storageBytesExact: true,
        uploadCountExact: true,
        updatedAt: Date.now(),
      });
      const postId = await ctx.db.insert("posts", {
        authorId: userId,
        body: "https://example.com/first",
        audience: "public",
        createdAt: Date.now(),
        commentCount: 0,
        reactionCounts: zeroReactions,
      });
      const firstImageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      );
      const secondImageId = await ctx.storage.store(
        new Blob([new Uint8Array([4, 5])], { type: "image/webp" }),
      );
      return { userId, postId, firstImageId, secondImageId };
    });

    expect(
      await t.mutation(internal.linkPreview.apply, {
        postId,
        expectedBody: "https://example.com/first",
        preview: {
          url: "https://example.com/first",
          title: "First",
          imageId: firstImageId,
        },
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.linkPreview.apply, {
        postId,
        expectedBody: "stale body",
        preview: { url: "https://example.com/stale", title: "Stale" },
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.linkPreview.apply, {
        postId,
        expectedBody: "https://example.com/first",
        preview: {
          url: "https://example.com/second",
          title: "Second",
          imageId: secondImageId,
        },
      }),
    ).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.storage.get(firstImageId)).toBeNull();
      expect(await ctx.storage.get(secondImageId)).not.toBeNull();
      const post = await ctx.db.get(postId);
      expect(post?.linkPreview).toMatchObject({ title: "Second", imageId: secondImageId });
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(stats).toMatchObject({ storageBytes: 2, uploadCount: 1 });
    });
  });
});
