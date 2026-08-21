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
  blockedPairIds,
  emptyReactionCounts,
  enrichPost,
  friendIdsOf,
  groupIdsOf,
  isBlockedEitherWay,
  loadVisiblePost,
  mutedPairIds,
  postVisibleTo,
  requireActiveUser,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import { extractFirstHttpUrl } from "./lib/unfurl";
import { internal } from "./_generated/api";
import {
  assertImage,
  assertVideo,
  claimUpload,
  deleteOwnedUpload,
  registerOwnedUpload,
} from "./lib/uploads";

async function paginateVisiblePosts(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  paginationOpts: PaginationOptions,
  authorId?: Id<"users">,
) {
  if (authorId && authorId !== viewerId && (await isBlockedEitherWay(ctx, viewerId, authorId))) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const [friendList, blockedIds, mutedIds, groupList] = await Promise.all([
    friendIdsOf(ctx, viewerId),
    blockedPairIds(ctx, viewerId),
    mutedPairIds(ctx, viewerId),
    groupIdsOf(ctx, viewerId),
  ]);
  const friendIds = new Set(friendList);
  const memberGroupIds = new Set(groupList);
  const target = Math.max(1, paginationOpts.numItems);
  const visible: Doc<"posts">[] = [];
  const cursorTime = paginationOpts.cursor ? Number(paginationOpts.cursor) : null;
  const batchSize = Math.max(target * 4, 40);
  const raw = authorId
    ? await ctx.db
        .query("posts")
        .withIndex("by_author", (q) => q.eq("authorId", authorId))
        .order("desc")
        .take(batchSize)
    : await ctx.db
        .query("posts")
        .withIndex("by_created", (q) =>
          cursorTime === null ? q : q.lt("createdAt", cursorTime),
        )
        .order("desc")
        .take(batchSize);
  let visibleCount = 0;
  for (const post of raw) {
    if (cursorTime !== null && post.createdAt >= cursorTime) continue;
    if (
      !postVisibleTo(
        post,
        viewerId,
        friendIds,
        blockedIds,
        authorId ? undefined : mutedIds,
        memberGroupIds,
      )
    )
      continue;
    visibleCount += 1;
    if (visible.length < target) visible.push(post);
  }
  const lastIncluded = visible[visible.length - 1];
  const lastRaw = raw[raw.length - 1];
  const exhausted = raw.length < batchSize;
  return {
    page: await Promise.all(visible.map((p) => enrichPost(ctx, p, viewerId))),
    isDone: exhausted && visibleCount <= target,
    continueCursor: lastIncluded
      ? String(lastIncluded.createdAt)
      : lastRaw && !exhausted
        ? String(lastRaw.createdAt)
        : "",
  };
}

export const MAX_POST_LENGTH = 5000;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireActiveUser(ctx);
    await takeRate(ctx, userId, "upload");
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerImage = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await requireActiveUser(ctx);
    await assertImage(ctx, storageId);
    return await registerOwnedUpload(ctx, userId, storageId);
  },
});

export const registerVideo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await requireActiveUser(ctx);
    await assertVideo(ctx, storageId);
    return await registerOwnedUpload(ctx, userId, storageId);
  },
});

export const create = mutation({
  args: {
    body: v.string(),
    audience: audienceValidator,
    imageId: v.optional(v.id("_storage")),
    imageIds: v.optional(v.array(v.id("_storage"))),
    videoId: v.optional(v.id("_storage")),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { body, audience, imageId, imageIds, videoId, groupId }) => {
    const authorId = await requireActiveUser(ctx);
    const photos = [...new Set([...(imageIds ?? []), ...(imageId ? [imageId] : [])])];
    if (photos.length > 4) throw new Error("At most 4 photos");
    const trimmed = body.trim();
    if (!trimmed && photos.length === 0 && !videoId) throw new Error("Post cannot be empty");
    if (trimmed.length > MAX_POST_LENGTH)
      throw new Error(`Post too long (max ${MAX_POST_LENGTH})`);
    if (photos.length > 0 && videoId) throw new Error("Attach photos or a video, not both");
    for (const id of photos) {
      await assertImage(ctx, id);
      await claimUpload(ctx, authorId, id);
    }
    if (videoId) {
      await assertVideo(ctx, videoId);
      await claimUpload(ctx, authorId, videoId);
    }
    if (groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", authorId),
        )
        .unique();
      if (!membership) throw new Error("Group not found");
    }
    await takeRate(ctx, authorId, "post");
    // Plan gate (SaaS spine): the free tier caps lifetime posts; Pro is
    // unlimited. Reads the effective plan so a lapsed sub downgrades correctly.
    const plan = await effectivePlan(ctx, authorId);
    const mine = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .collect();
    assertWithinLimit("posts", mine.length, planLimits(plan).posts, plan);
    const postId = await ctx.db.insert("posts", {
      authorId,
      body: trimmed,
      audience,
      createdAt: Date.now(),
      imageId: photos[0],
      imageIds: photos.length > 0 ? photos : undefined,
      videoId,
      groupId,
      commentCount: 0,
      reactionCounts: emptyReactionCounts(),
    });
    if (extractFirstHttpUrl(trimmed)) {
      await ctx.scheduler.runAfter(0, internal.linkPreview.unfurl, { postId, body: trimmed });
    }
    return postId;
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

export const update = mutation({
  args: {
    id: v.id("posts"),
    body: v.string(),
    audience: v.optional(audienceValidator),
  },
  handler: async (ctx, { id, body, audience }) => {
    const userId = await requireActiveUser(ctx);
    const post = await ctx.db.get(id);
    if (!post || post.authorId !== userId) throw new Error("Post not found");
    const trimmed = body.trim();
    if (!trimmed && !post.imageId) throw new Error("Post cannot be empty");
    if (trimmed.length > MAX_POST_LENGTH)
      throw new Error(`Post too long (max ${MAX_POST_LENGTH})`);
    const patch: {
      body: string;
      editedAt: number;
      audience?: "public" | "friends";
    } = {
      body: trimmed,
      editedAt: Date.now(),
    };
    if (audience) patch.audience = audience;
    await ctx.db.patch(id, patch);
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return [];
    const term = q.trim();
    if (!term) return [];
    const [friendList, blockedIds, mutedIds, groupList] = await Promise.all([
      friendIdsOf(ctx, viewerId),
      blockedPairIds(ctx, viewerId),
      mutedPairIds(ctx, viewerId),
      groupIdsOf(ctx, viewerId),
    ]);
    const friendIds = new Set(friendList);
    const memberGroupIds = new Set(groupList);
    const hits = await ctx.db
      .query("posts")
      .withSearchIndex("search_body", (s) => s.search("body", term))
      .take(20);
    const visible = hits.filter((p) =>
      postVisibleTo(p, viewerId, friendIds, blockedIds, mutedIds, memberGroupIds),
    );
    return await Promise.all(visible.slice(0, 8).map((p) => enrichPost(ctx, p, viewerId)));
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
    const userId = await requireActiveUser(ctx);
    const post = await ctx.db.get(id);
    if (!post) return;
    if (post.authorId !== userId)
      throw new Error("Only the author can delete a post");
    const mediaIds = [
      ...(post.imageIds ?? []),
      ...(post.imageId ? [post.imageId] : []),
      ...(post.videoId ? [post.videoId] : []),
    ];
    for (const storageId of new Set(mediaIds)) {
      await deleteOwnedUpload(ctx, userId, storageId);
    }
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
    const saves = await ctx.db
      .query("savedPosts")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .collect();
    for (const save of saves) await ctx.db.delete(save._id);
    await ctx.db.delete(id);
  },
});
