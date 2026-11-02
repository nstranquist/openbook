import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import {
  authorCard,
  occupyPair,
  pairKey,
  requireActiveProfile,
  requireActiveUser,
} from "./lib/social";
import { MAX_MUTES, MAX_PAIR_ROWS } from "./lib/limits";
import { takeRate } from "./lib/rate";
import { boundedPaginationOptions } from "./lib/pagination";

export const set = mutation({
  args: { userId: v.id("users"), muted: v.boolean() },
  handler: async (ctx, { userId, muted }) => {
    const me = await requireActiveUser(ctx);
    if (me === userId) throw new Error("You cannot mute yourself");
    if (muted) await requireActiveProfile(ctx, userId);
    await takeRate(ctx, me, "block");
    const key = pairKey(me, userId);
    const pairRows = await ctx.db
      .query("mutes")
      .withIndex("by_pair", (q) => q.eq("pairKey", key))
      .take(MAX_PAIR_ROWS);
    const existing = pairRows.filter((row) => row.muterId === me && row.mutedId === userId);
    if (muted) {
      if (existing.length === 0) {
        const mine = await ctx.db
          .query("mutes")
          .withIndex("by_muter", (q) => q.eq("muterId", me))
          .take(MAX_MUTES);
        if (mine.length >= MAX_MUTES) throw new Error(`Mute limit reached (${MAX_MUTES})`);
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
    const rows = await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q) => q.eq("muterId", me))
      .take(MAX_MUTES);
    return await Promise.all(rows.map(async (row) => authorCard(ctx, row.mutedId)));
  },
});

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q) => q.eq("muterId", me))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await Promise.all(result.page.map(async (row) => authorCard(ctx, row.mutedId))),
    };
  },
});
