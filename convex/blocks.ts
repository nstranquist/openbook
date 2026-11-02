import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import {
  authorCard,
  deleteFriendEdges,
  deleteNotificationsBetween,
  friendshipForPair,
  occupyPair,
  pairKey,
  requireActiveProfile,
  requireActiveUser,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import { MAX_BLOCKS, MAX_PAIR_ROWS } from "./lib/limits";
import { adjustUserStat } from "./lib/stats";
import { boundedPaginationOptions } from "./lib/pagination";

export const set = mutation({
  args: { userId: v.id("users"), blocked: v.boolean() },
  handler: async (ctx, { userId, blocked }) => {
    const me = await requireActiveUser(ctx);
    if (me === userId) throw new Error("You cannot block yourself");
    if (blocked) await requireActiveProfile(ctx, userId);
    await takeRate(ctx, me, "block");
    const key = pairKey(me, userId);
    const pairRows = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) => q.eq("pairKey", key))
      .take(MAX_PAIR_ROWS);
    const existingRows = pairRows.filter(
      (row) => row.blockerId === me && row.blockedId === userId,
    );
    if (blocked) {
      if (existingRows.length === 0) {
        const mine = await ctx.db
          .query("blocks")
          .withIndex("by_blocker", (q) => q.eq("blockerId", me))
          .take(MAX_BLOCKS);
        if (mine.length >= MAX_BLOCKS) throw new Error(`Block limit reached (${MAX_BLOCKS})`);
        await occupyPair(ctx, "block", key);
        await ctx.db.insert("blocks", {
          blockerId: me,
          blockedId: userId,
          pairKey: key,
          createdAt: Date.now(),
        });
      }
      const edge = await friendshipForPair(ctx, me, userId);
      if (edge) {
        if (edge.status === "accepted") {
          await deleteFriendEdges(ctx, me, userId);
        }
        await ctx.db.delete(edge._id);
        if (edge.status === "accepted") {
          await adjustUserStat(ctx, me, "friendCount", -1);
          await adjustUserStat(ctx, userId, "friendCount", -1);
        }
      }
      await deleteNotificationsBetween(ctx, me, userId);
      await deleteNotificationsBetween(ctx, userId, me);
      return;
    }
    for (const row of existingRows) await ctx.db.delete(row._id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .take(MAX_BLOCKS);
    return await Promise.all(
      rows.map(async (row) => ({
        ...(await authorCard(ctx, row.blockedId)),
        blockedAt: row.createdAt,
      })),
    );
  },
});

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await Promise.all(result.page.map(async (row) => ({
        ...(await authorCard(ctx, row.blockedId)),
        blockedAt: row.createdAt,
      }))),
    };
  },
});
