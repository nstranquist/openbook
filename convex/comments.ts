import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorCard, loadVisiblePost, notify, requireActiveUser, requireVisiblePost } from "./lib/social";
import { takeRate } from "./lib/rate";

export const MAX_COMMENT_LENGTH = 2000;

// Comments keep posts.commentCount exact: the counter and the row move in the
// same mutation transaction, and the post author gets one notification.

export const add = mutation({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, { postId, body }) => {
    const authorId = await requireActiveUser(ctx);
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Comment cannot be empty");
    if (trimmed.length > MAX_COMMENT_LENGTH)
      throw new Error(`Comment too long (max ${MAX_COMMENT_LENGTH})`);
    await takeRate(ctx, authorId, "comment");
    const post = await requireVisiblePost(ctx, postId, authorId);
    const id = await ctx.db.insert("comments", {
      postId,
      authorId,
      body: trimmed,
      createdAt: Date.now(),
    });
    await ctx.db.patch(postId, { commentCount: post.commentCount + 1 });
    await notify(ctx, {
      userId: post.authorId,
      actorId: authorId,
      kind: "comment",
      postId,
    });
    return id;
  },
});

export const list = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return [];
    if (!(await loadVisiblePost(ctx, postId, viewerId))) return [];
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect();
    return await Promise.all(
      rows.map(async (c) => ({
        _id: c._id,
        body: c.body,
        createdAt: c.createdAt,
        author: await authorCard(ctx, c.authorId),
        isMine: c.authorId === viewerId,
      })),
    );
  },
});

// Comment author or post author may remove; the counter stays exact.
export const remove = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const comment = await ctx.db.get(id);
    if (!comment) return;
    const post = await ctx.db.get(comment.postId);
    if (!post) {
      await ctx.db.delete(id);
      return;
    }
    const isAuthor = comment.authorId === userId;
    const isPostOwner = post.authorId === userId;
    if (!isAuthor && !isPostOwner)
      throw new Error("Not allowed to delete this comment");
    if (isPostOwner && !isAuthor) await requireVisiblePost(ctx, comment.postId, userId);
    await ctx.db.delete(id);
    await ctx.db.patch(post._id, {
      commentCount: Math.max(0, post.commentCount - 1),
    });
  },
});
