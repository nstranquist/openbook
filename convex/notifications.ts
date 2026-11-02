import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  authorCard,
  deleteNotificationsBetween,
  requireActiveUser,
} from "./lib/social";
import { MAX_UNREAD_BADGE, NOTIFICATION_WRITE_BATCH } from "./lib/limits";
import { adjustUserStat, userStats } from "./lib/stats";
import { boundedPaginationOptions } from "./lib/pagination";

// The bell. Recipient-scoped reads, enriched with the actor's card so the
// dropdown renders names/avatars without N client round-trips.

async function enrich(ctx: QueryCtx, rows: Doc<"notifications">[]) {
  return await Promise.all(
    rows.map(async (notification) => ({
      _id: notification._id,
      kind: notification.kind,
      postId: notification.postId ?? null,
      read: notification.read,
      createdAt: notification.createdAt,
      actor: await authorCard(ctx, notification.actorId),
    })),
  );
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me))
      .order("desc")
      .take(30);
    return await enrich(ctx, rows);
  },
});

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return { ...result, page: await enrich(ctx, result.page) };
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return 0;
    const stats = await userStats(ctx, me);
    if (stats?.notificationUnreadCountExact) {
      return Math.min(stats.notificationUnreadCount, MAX_UNREAD_BADGE);
    }
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", me).eq("read", false))
      .take(MAX_UNREAD_BADGE);
    return unread.length;
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    const me = await requireActiveUser(ctx);
    const n = await ctx.db.get(id);
    if (n && n.userId === me && !n.read) {
      await ctx.db.patch(id, { read: true });
      await adjustUserStat(ctx, me, "notificationUnreadCount", -1);
    }
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx);
    await markUnreadBatch(ctx, me, Date.now());
  },
});

async function markUnreadBatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  cutoff: number,
): Promise<void> {
  const unread = await ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId).eq("read", false))
    .take(NOTIFICATION_WRITE_BATCH);
  const eligible = unread.filter((notification) => notification.createdAt <= cutoff);
  for (const notification of eligible) await ctx.db.patch(notification._id, { read: true });
  if (eligible.length > 0) {
    await adjustUserStat(ctx, userId, "notificationUnreadCount", -eligible.length);
  }
  if (
    unread.length === NOTIFICATION_WRITE_BATCH &&
    eligible.length === unread.length
  ) {
    await ctx.scheduler.runAfter(0, internal.notifications.markAllReadBatch, {
      userId,
      cutoff,
    });
  }
}

export const markAllReadBatch = internalMutation({
  args: { userId: v.id("users"), cutoff: v.number() },
  handler: async (ctx, { userId, cutoff }) => {
    await markUnreadBatch(ctx, userId, cutoff);
  },
});

const notificationKindValidator = v.union(
  v.literal("friend_request"),
  v.literal("friend_accept"),
  v.literal("reaction"),
  v.literal("comment"),
);

export const deleteBetweenBatch = internalMutation({
  args: {
    recipientId: v.id("users"),
    actorId: v.id("users"),
    kinds: v.optional(v.array(notificationKindValidator)),
  },
  handler: async (ctx, { recipientId, actorId, kinds }) => {
    await deleteNotificationsBetween(ctx, recipientId, actorId, kinds);
  },
});
