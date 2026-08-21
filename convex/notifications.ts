import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authorCard } from "./lib/social";

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
    const me = await getAuthUserId(ctx);
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
    const me = await getAuthUserId(ctx);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: await enrich(ctx, result.page) };
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (!me) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", me).eq("read", false))
      .collect();
    return unread.length;
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const n = await ctx.db.get(id);
    if (n && n.userId === me && !n.read) await ctx.db.patch(id, { read: true });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", me).eq("read", false))
      .collect();
    for (const n of unread) await ctx.db.patch(n._id, { read: true });
  },
});
