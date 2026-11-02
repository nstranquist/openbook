import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { PaginationOptions } from "convex/server";
import { audienceValidator } from "./schema";
import { effectivePlan, planLimits, assertWithinLimit } from "./lib/plans";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  emptyReactionCounts,
  enrichPost,
  isBlockedEitherWay,
  loadVisiblePost,
  postVisibilityEvaluator,
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
  generateGrantedUploadUrl,
  registerGrantedUpload,
} from "./lib/uploads";
import { adjustUserStat, userStats } from "./lib/stats";
import { boundedPaginationOptions } from "./lib/pagination";

async function paginateVisiblePosts(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  paginationOpts: PaginationOptions,
  authorId?: Id<"users">,
) {
  if (authorId && authorId !== viewerId && (await isBlockedEitherWay(ctx, viewerId, authorId))) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const bounded = boundedPaginationOptions(paginationOpts);
  const target = bounded.numItems;
  const visible: Doc<"posts">[] = [];
  const cursorCreationTime = bounded.cursor ? Number(bounded.cursor) : null;
  if (cursorCreationTime !== null && !Number.isFinite(cursorCreationTime)) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const batchSize = Math.max(target * 4, 40);
  const raw = authorId
    ? await ctx.db
        .query("posts")
        .withIndex("by_author", (q) =>
          cursorCreationTime === null
            ? q.eq("authorId", authorId)
            : q.eq("authorId", authorId).lt("_creationTime", cursorCreationTime),
        )
        .order("desc")
        .take(batchSize)
    : await ctx.db
        .query("posts")
        .withIndex("by_creation_time", (q) =>
          cursorCreationTime === null ? q : q.lt("_creationTime", cursorCreationTime),
        )
        .order("desc")
        .take(batchSize);
  let visibleCount = 0;
  const evaluateVisibility = postVisibilityEvaluator(ctx, viewerId, !authorId);
  const visibility = await Promise.all(raw.map(evaluateVisibility));
  for (const [index, post] of raw.entries()) {
    if (!visibility[index]) continue;
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
      ? String(lastIncluded._creationTime)
      : lastRaw && !exhausted
        ? String(lastRaw._creationTime)
        : "",
  };
}

export const MAX_POST_LENGTH = 5000;

export const generateUploadUrl = mutation({
  args: {
    kind: v.union(v.literal("image"), v.literal("video")),
    declaredBytes: v.number(),
  },
  handler: async (ctx, { kind, declaredBytes }) => {
    const userId = await requireActiveUser(ctx);
    await takeRate(ctx, userId, "upload");
    return await generateGrantedUploadUrl(ctx, userId, kind, declaredBytes);
  },
});

export const registerImage = mutation({
  args: { storageId: v.id("_storage"), grantId: v.id("uploadGrants") },
  handler: async (ctx, { storageId, grantId }) => {
    const userId = await requireActiveUser(ctx);
    return await registerGrantedUpload(ctx, userId, grantId, storageId, "image");
  },
});

export const registerVideo = mutation({
  args: { storageId: v.id("_storage"), grantId: v.id("uploadGrants") },
  handler: async (ctx, { storageId, grantId }) => {
    const userId = await requireActiveUser(ctx);
    return await registerGrantedUpload(ctx, userId, grantId, storageId, "video");
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
    const limit = planLimits(plan).posts;
    const stats = await userStats(ctx, authorId);
    if (stats?.postCountExact) {
      assertWithinLimit("posts", stats.postCount, limit, plan);
    } else if (limit !== null) {
      const mine = await ctx.db
        .query("posts")
        .withIndex("by_author", (q) => q.eq("authorId", authorId))
        .take(limit);
      assertWithinLimit("posts", mine.length, limit, plan);
    }
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
      await ctx.scheduler.runAfter(0, internal.linkPreviewFetch.unfurl, {
        postId,
        body: trimmed,
      });
    }
    await adjustUserStat(ctx, authorId, "postCount", 1);
    return postId;
  },
});

// The home feed: newest-first over everything the viewer may see — their own
// posts, friends' posts, and public posts (discovery). Reactive + paginated;
// visibility is filtered server-side so a client never receives a hidden post.
export const feed = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewerId = await requireActiveUser(ctx).catch(() => null);
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
    if (!trimmed && !post.imageId && !(post.imageIds?.length) && !post.videoId) {
      throw new Error("Post cannot be empty");
    }
    if (trimmed.length > MAX_POST_LENGTH)
      throw new Error(`Post too long (max ${MAX_POST_LENGTH})`);
    await takeRate(ctx, userId, "post");
    const patch: {
      body: string;
      editedAt: number;
      audience?: "public" | "friends";
      linkPreview?: undefined;
    } = {
      body: trimmed,
      editedAt: Date.now(),
      linkPreview: undefined,
    };
    if (audience) patch.audience = audience;
    await ctx.db.patch(id, patch);
    if (post.linkPreview?.imageId) {
      await deleteOwnedUpload(ctx, userId, post.linkPreview.imageId);
    }
    if (extractFirstHttpUrl(trimmed)) {
      await ctx.scheduler.runAfter(0, internal.linkPreviewFetch.unfurl, {
        postId: id,
        body: trimmed,
      });
    }
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const viewerId = await requireActiveUser(ctx).catch(() => null);
    if (!viewerId) return [];
    const term = q.trim();
    if (!term) return [];
    const hits = await ctx.db
      .query("posts")
      .withSearchIndex("search_body", (s) => s.search("body", term))
      .take(20);
    const evaluateVisibility = postVisibilityEvaluator(ctx, viewerId);
    const visibility = await Promise.all(hits.map(evaluateVisibility));
    const visible = hits.filter((_, index) => visibility[index]);
    return await Promise.all(visible.slice(0, 8).map((p) => enrichPost(ctx, p, viewerId)));
  },
});

export const get = query({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => {
    const viewerId = await requireActiveUser(ctx).catch(() => null);
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
    const viewerId = await requireActiveUser(ctx).catch(() => null);
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
    if (!post || post.deletedAt) return;
    if (post.authorId !== userId)
      throw new Error("Only the author can delete a post");
    await ctx.db.patch(id, { deletedAt: Date.now(), body: "" });
    await adjustUserStat(ctx, userId, "postCount", -1);
    await ctx.scheduler.runAfter(0, internal.posts.purgeDeletedBatch, { postId: id });
  },
});

export const purgeDeletedBatch = internalMutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post?.deletedAt) return;
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(100);
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(100);
    for (const c of comments) await ctx.db.delete(c._id);
    for (const r of reactions) await ctx.db.delete(r._id);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(100);
    const unreadByUser = new Map<Id<"users">, number>();
    for (const notification of notifications) {
      if (!notification.read) {
        unreadByUser.set(
          notification.userId,
          (unreadByUser.get(notification.userId) ?? 0) + 1,
        );
      }
      await ctx.db.delete(notification._id);
    }
    for (const [userId, count] of unreadByUser) {
      await adjustUserStat(ctx, userId, "notificationUnreadCount", -count);
    }
    const saves = await ctx.db
      .query("savedPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(100);
    for (const save of saves) await ctx.db.delete(save._id);
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(100);
    for (const report of reports) await ctx.db.patch(report._id, { postId: undefined });
    if ([comments, reactions, notifications, saves, reports].some((rows) => rows.length === 100)) {
      await ctx.scheduler.runAfter(0, internal.posts.purgeDeletedBatch, { postId });
      return;
    }
    const mediaIds = [
      ...(post.imageIds ?? []),
      ...(post.imageId ? [post.imageId] : []),
      ...(post.videoId ? [post.videoId] : []),
    ];
    for (const storageId of new Set(mediaIds)) {
      await deleteOwnedUpload(ctx, post.authorId, storageId);
    }
    if (post.linkPreview?.imageId) {
      await deleteOwnedUpload(ctx, post.authorId, post.linkPreview.imageId);
    }
    await ctx.db.delete(postId);
  },
});
