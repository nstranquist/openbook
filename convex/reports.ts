import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import {
  isOperator,
  loadVisiblePost,
  requireActiveProfile,
  requireActiveUser,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import { boundedPaginationOptions } from "./lib/pagination";

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
    let target = targetUserId;
    if (postId) {
      const post = await loadVisiblePost(ctx, postId, me);
      if (!post) throw new Error("Post not found");
      if (target && target !== post.authorId) throw new Error("Report target does not match post");
      target = post.authorId;
    }
    if (!target) throw new Error("Nothing to report");
    await requireActiveProfile(ctx, target);
    if (target === me) throw new Error("You cannot report yourself");
    const duplicate = postId
      ? await ctx.db
          .query("reports")
          .withIndex("by_reporter_post_status", (q) =>
            q.eq("reporterId", me).eq("postId", postId).eq("status", "open"),
          )
          .first()
      : await ctx.db
          .query("reports")
          .withIndex("by_reporter_target_status", (q) =>
            q.eq("reporterId", me).eq("targetUserId", target).eq("status", "open"),
          )
          .first();
    if (duplicate) return duplicate._id;
    await takeRate(ctx, me, "report");
    return await ctx.db.insert("reports", {
      reporterId: me,
      targetUserId: target,
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

export const queuePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me || !isOperator(me)) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
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
