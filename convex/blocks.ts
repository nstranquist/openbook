import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  authorCard,
  deleteNotificationsBetween,
  friendshipForPair,
  pairKey,
} from "./lib/social";
import { takeRate } from "./lib/rate";

export const set = mutation({
  args: { userId: v.id("users"), blocked: v.boolean() },
  handler: async (ctx, { userId, blocked }) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    if (me === userId) throw new Error("You cannot block yourself");
    const other = await ctx.db.get(userId);
    if (!other) throw new Error("User not found");
    await takeRate(ctx, me, "block");
    const key = pairKey(me, userId);
    const mine = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect();
    const existing = mine.find((row) => row.blockedId === userId) ?? null;
    if (blocked) {
      if (!existing) {
        await ctx.db.insert("blocks", {
          blockerId: me,
          blockedId: userId,
          pairKey: key,
          createdAt: Date.now(),
        });
      }
      const edge = await friendshipForPair(ctx, me, userId);
      if (edge) await ctx.db.delete(edge._id);
      await deleteNotificationsBetween(ctx, me, userId);
      await deleteNotificationsBetween(ctx, userId, me);
      return;
    }
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        ...(await authorCard(ctx, row.blockedId)),
        blockedAt: row.createdAt,
      })),
    );
  },
});
