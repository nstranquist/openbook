import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorCard, occupyPair, pairKey, requireActiveUser } from "./lib/social";

export const set = mutation({
  args: { userId: v.id("users"), muted: v.boolean() },
  handler: async (ctx, { userId, muted }) => {
    const me = await requireActiveUser(ctx);
    if (me === userId) throw new Error("You cannot mute yourself");
    const key = pairKey(me, userId);
    const mine = await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q) => q.eq("muterId", me))
      .collect();
    const existing = mine.filter((row) => row.mutedId === userId);
    if (muted) {
      if (existing.length === 0) {
        await occupyPair(ctx, "mute", key);
        await ctx.db.insert("mutes", {
          muterId: me,
          mutedId: userId,
          pairKey: key,
          createdAt: Date.now(),
        });
      }
      return;
    }
    for (const row of existing) await ctx.db.delete(row._id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const rows = await ctx.db.query("mutes").withIndex("by_muter", (q) => q.eq("muterId", me)).collect();
    return await Promise.all(rows.map(async (row) => authorCard(ctx, row.mutedId)));
  },
});
