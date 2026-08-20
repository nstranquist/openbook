import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isOperator, requireActiveUser } from "./lib/social";
import { takeRate } from "./lib/rate";

export const create = mutation({
  args: {
    targetUserId: v.optional(v.id("users")),
    postId: v.optional(v.id("posts")),
    reason: v.string(),
  },
  handler: async (ctx, { targetUserId, postId, reason }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("Reason required");
    if (!targetUserId && !postId) throw new Error("Nothing to report");
    await takeRate(ctx, me, "report");
    return await ctx.db.insert("reports", {
      reporterId: me,
      targetUserId,
      postId,
      reason: trimmed.slice(0, 500),
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    return await ctx.db
      .query("reports")
      .withIndex("by_reporter", (q) => q.eq("reporterId", me))
      .take(20);
  },
});

export const withdraw = mutation({
  args: { id: v.id("reports") },
  handler: async (ctx, { id }) => {
    const me = await requireActiveUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.reporterId !== me) throw new Error("Report not found");
    if (row.status !== "open") return;
    await ctx.db.patch(id, { status: "closed" });
  },
});

export const queue = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me || !isOperator(me)) return [];
    return await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(40);
  },
});

export const review = mutation({
  args: {
    id: v.id("reports"),
    status: v.union(v.literal("open"), v.literal("closed")),
  },
  handler: async (ctx, { id, status }) => {
    const me = await requireActiveUser(ctx);
    if (!isOperator(me)) throw new Error("Not allowed");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Report not found");
    await ctx.db.patch(id, { status });
  },
});
