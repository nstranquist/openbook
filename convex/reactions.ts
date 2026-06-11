import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { reactionKindValidator } from "./schema";
import { authorCard, notify, type ReactionKind } from "./lib/social";

// Facebook-style reactions: one row per (post, user). `toggle` is the single
// write path — same kind removes, different kind switches — and the post's
// denormalized tally moves in the same transaction. Only a NEW reaction
// notifies the post author (switching kinds doesn't re-ping).

export const toggle = mutation({
  args: { postId: v.id("posts"), kind: reactionKindValidator },
  handler: async (ctx, { postId, kind }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("Post not found");
    const counts = { ...post.reactionCounts } as Record<ReactionKind, number>;
    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_post_user", (q) =>
        q.eq("postId", postId).eq("userId", userId),
      )
      .unique();

    if (existing && existing.kind === kind) {
      await ctx.db.delete(existing._id);
      counts[kind] = Math.max(0, counts[kind] - 1);
      await ctx.db.patch(postId, { reactionCounts: counts });
      return { myReaction: null };
    }
    if (existing) {
      counts[existing.kind as ReactionKind] = Math.max(
        0,
        counts[existing.kind as ReactionKind] - 1,
      );
      await ctx.db.patch(existing._id, { kind });
    } else {
      await ctx.db.insert("reactions", { postId, userId, kind });
      await notify(ctx, {
        userId: post.authorId,
        actorId: userId,
        kind: "reaction",
        postId,
      });
    }
    counts[kind] += 1;
    await ctx.db.patch(postId, { reactionCounts: counts });
    return { myReaction: kind };
  },
});

// Who reacted (for the "people who reacted" popover).
export const listForPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return [];
    const rows = await ctx.db
      .query("reactions")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .collect();
    return await Promise.all(
      rows.map(async (r) => ({
        kind: r.kind,
        author: await authorCard(ctx, r.userId),
      })),
    );
  },
});
