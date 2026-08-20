import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  authorCard,
  blockedPairIds,
  friendIdsOf,
  requireActiveUser,
} from "./lib/social";
import { audienceValidator } from "./schema";
import { assertImage, claimUpload } from "./lib/uploads";
import { takeRate } from "./lib/rate";

const DAY_MS = 24 * 60 * 60 * 1000;

export const create = mutation({
  args: {
    body: v.string(),
    audience: audienceValidator,
    imageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { body, audience, imageId }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = body.trim();
    if (!trimmed && !imageId) throw new Error("Story cannot be empty");
    if (imageId) {
      await assertImage(ctx, imageId);
      await claimUpload(ctx, me, imageId);
    }
    await takeRate(ctx, me, "story");
    const now = Date.now();
    return await ctx.db.insert("stories", {
      authorId: me,
      body: trimmed.slice(0, 280),
      imageId,
      audience,
      createdAt: now,
      expiresAt: now + DAY_MS,
    });
  },
});

export const feed = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const now = Date.now();
    const [friends, blocked] = await Promise.all([
      friendIdsOf(ctx, me),
      blockedPairIds(ctx, me),
    ]);
    const friendSet = new Set(friends);
    const recent = await ctx.db.query("stories").order("desc").take(80);
    const visible = recent.filter((s) => {
      if (s.expiresAt <= now) return false;
      if (s.authorId === me) return true;
      if (blocked.has(s.authorId)) return false;
      if (s.audience === "public") return true;
      return friendSet.has(s.authorId);
    });
    return await Promise.all(
      visible.slice(0, 24).map(async (s) => ({
        ...s,
        author: await authorCard(ctx, s.authorId),
        imageUrl: s.imageId
          ? (await (await import("./lib/mediaSign")).signedMediaUrl(s.imageId)) ??
            (await ctx.storage.getUrl(s.imageId))
          : null,
      })),
    );
  },
});
