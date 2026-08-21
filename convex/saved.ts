import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { enrichPost, loadVisiblePost, requireActiveUser } from "./lib/social";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const rows = await ctx.db
      .query("savedPosts")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(paginationOpts);
    const page = await Promise.all(
      rows.page.map(async (row) => {
        const post = await loadVisiblePost(ctx, row.postId, userId);
        if (!post) return null;
        return { ...(await enrichPost(ctx, post, userId)), savedAt: row.createdAt };
      }),
    );
    return {
      ...rows,
      page: page.filter((post): post is NonNullable<typeof post> => post !== null),
    };
  },
});

export const toggle = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const userId = await requireActiveUser(ctx);
    const post = await loadVisiblePost(ctx, postId, userId);
    if (!post) throw new Error("Post not found");
    const existing = await ctx.db
      .query("savedPosts")
      .withIndex("by_user_post", (q) => q.eq("userId", userId).eq("postId", postId))
      .collect();
    if (existing.length > 0) {
      for (const row of existing) await ctx.db.delete(row._id);
      return false;
    }
    await ctx.db.insert("savedPosts", { userId, postId, createdAt: Date.now() });
    return true;
  },
});
