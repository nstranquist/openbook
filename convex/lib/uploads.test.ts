import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import {
  assertImageMetadata,
  deleteOwnedUpload,
  registerOwnedUpload,
} from "./uploads";

async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "upload@example.test" });
    await ctx.db.insert("profiles", {
      userId,
      displayName: "Upload Test",
      avatarHue: 1,
      coverHue: 2,
      joinedAt: Date.now(),
    });
    await ctx.db.insert("userStats", {
      userId,
      postCount: 0,
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
    return userId;
  });
  return { t, userId };
}

describe("owned uploads", () => {
  it("accepts safe raster media and keeps exact storage usage", async () => {
    const { t, userId } = await fixture();
    const storageId = await t.run(async (ctx) =>
      await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    );
    await t.run(async (ctx) => {
      await registerOwnedUpload(ctx, userId, storageId);
      // Registration is idempotent and must not reserve quota twice.
      await registerOwnedUpload(ctx, userId, storageId);
    });
    await t.run(async (ctx) => {
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(stats).toMatchObject({ storageBytes: 3, uploadCount: 1 });
      await deleteOwnedUpload(ctx, userId, storageId);
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(storageId)).toBeNull();
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(stats).toMatchObject({ storageBytes: 0, uploadCount: 0 });
    });
  });

  it("rejects active content and enforces the byte quota", async () => {
    const { t, userId } = await fixture();
    expect(() =>
      assertImageMetadata({ contentType: "image/svg+xml", size: 6 }),
    ).toThrow(/must be an image/i);
    expect(() => assertImageMetadata({ contentType: "image/png", size: 0 })).toThrow(
      /empty/i,
    );

    const imageId = await t.run(async (ctx) => {
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      await ctx.db.patch(stats!._id, { storageBytes: 499_999_999 });
      return await ctx.storage.store(
        new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
      );
    });
    await expect(
      t.run(async (ctx) => await registerOwnedUpload(ctx, userId, imageId)),
    ).rejects.toThrow(/plan limit reached/i);
  });
});
