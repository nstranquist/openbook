import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { PaginationOptions } from "convex/server";
import { audienceValidator } from "./schema";
import { effectivePlan, planLimits, assertWithinLimit } from "./lib/plans";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  emptyReactionCounts,
  enrichPost,
  friendIdsOf,
  loadVisiblePost,
  postVisibleTo,
} from "./lib/social";

const FEED_SCAN_PAGES = 8;

async function paginateVisiblePosts(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  paginationOpts: PaginationOptions,
  authorId?: Id<"users">,
) {
  const friendIds = new Set(await friendIdsOf(ctx, viewerId));
  const target = Math.max(1, paginationOpts.numItems);
  const visible: Doc<"posts">[] = [];
  let cursor = paginationOpts.cursor;
  let isDone = false;
  let continueCursor = cursor ?? "";
  for (let scan = 0; scan < FEED_SCAN_PAGES && visible.length < target && !isDone; scan++) {
    const page = authorId
      ? await ctx.db
          .query("posts")
          .withIndex("by_author", (q) => q.eq("authorId", authorId))
          .order("desc")
          .paginate({ numItems: target, cursor })
      : await ctx.db
          .query("posts")
          .withIndex("by_created")
          .order("desc")
          .paginate({ numItems: target, cursor });
    for (const post of page.page) {
      if (postVisibleTo(post, viewerId, friendIds)) visible.push(post);
    }
    isDone = page.isDone;
    continueCursor = page.continueCursor;
    cursor = page.continueCursor;
  }
  return {
    page: await Promise.all(visible.map((p) => enrichPost(ctx, p, viewerId))),
    isDone,
    continueCursor,
  };
}

export const MAX_POST_LENGTH = 5000;

export const create = mutation({
  args: { body: v.string(), audience: audienceValidator },
  handler: async (ctx, { body, audience }) => {
    const authorId = await getAuthUserId(ctx);
    if (!authorId) throw new Error("Not authenticated");
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Post cannot be empty");
    if (trimmed.length > MAX_POST_LENGTH)
      throw new Error(`Post too long (max ${MAX_POST_LENGTH})`);
    // Plan gate (SaaS spine): the free tier caps lifetime posts; Pro is
    // unlimited. Reads the effective plan so a lapsed sub downgrades correctly.
    const plan = await effectivePlan(ctx, authorId);
    const mine = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .collect();
    assertWithinLimit("posts", mine.length, planLimits(plan).posts, plan);
    return await ctx.db.insert("posts", {
      authorId,
      body: trimmed,
      audience,
      createdAt: Date.now(),
      commentCount: 0,
      reactionCounts: emptyReactionCounts(),
    });
  },
});

// The home feed: newest-first over everything the viewer may see — their own
// posts, friends' posts, and public posts (discovery). Reactive + paginated;
// visibility is filtered server-side so a client never receives a hidden post.
export const feed = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId)
      return { page: [], isDone: true, continueCursor: "" };
    return await paginateVisiblePosts(ctx, viewerId, paginationOpts);
  },
});

export const get = query({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return null;
    const post = await loadVisiblePost(ctx, id, viewerId);
    if (!post) return null;
    return await enrichPost(ctx, post, viewerId);
  },
});

// A profile's timeline, visibility-filtered for the viewer: non-friends only
// see public posts.
export const forProfile = query({
  args: {
    userId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { userId, paginationOpts }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId)
      return { page: [], isDone: true, continueCursor: "" };
    return await paginateVisiblePosts(ctx, viewerId, paginationOpts, userId);
  },
});

// Delete cascades to comments, reactions, and post-scoped notifications so no
// orphan rows (or dangling notification links) survive.
export const remove = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const post = await ctx.db.get(id);
    if (!post) return;
    if (post.authorId !== userId)
      throw new Error("Only the author can delete a post");
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .collect();
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    for (const r of reactions) await ctx.db.delete(r._id);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", post.authorId))
      .collect();
    for (const n of notifications) {
      if (n.postId === id) await ctx.db.delete(n._id);
    }
    await ctx.db.delete(id);
  },
});
