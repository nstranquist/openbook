import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireActiveUser } from "./lib/social";
import { MAX_PUSH_SUBSCRIPTIONS } from "./lib/limits";
import { normalizePushEndpoint, validPushSubscriptionKeys } from "./lib/pushEndpoint";
import { takeRate } from "./lib/rate";
import { pushIsEnabled } from "./lib/runtime";

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, { endpoint, p256dh, auth }) => {
    const me = await requireActiveUser(ctx);
    await takeRate(ctx, me, "push");
    const trimmed = normalizePushEndpoint(endpoint);
    if (!trimmed) throw new Error("Invalid push endpoint");
    if (!validPushSubscriptionKeys(p256dh, auth)) throw new Error("Invalid push subscription keys");
    if (!pushIsEnabled()) throw new Error("Browser notifications are not enabled");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", trimmed))
      .first();
    if (existing) {
      if (existing.userId !== me) throw new Error("Push endpoint in use");
      await ctx.db.patch(existing._id, { p256dh, auth });
      return existing._id;
    }
    const mine = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_PUSH_SUBSCRIPTIONS);
    if (mine.length >= MAX_PUSH_SUBSCRIPTIONS) {
      throw new Error(`Push subscription limit reached (${MAX_PUSH_SUBSCRIPTIONS})`);
    }
    return await ctx.db.insert("pushSubscriptions", {
      userId: me,
      endpoint: trimmed,
      p256dh,
      auth,
      createdAt: Date.now(),
    });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const me = await requireActiveUser(ctx);
    await takeRate(ctx, me, "push");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint.trim()))
      .first();
    if (existing && existing.userId === me) await ctx.db.delete(existing._id);
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    if (!pushIsEnabled()) return [];
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_PUSH_SUBSCRIPTIONS);
    return rows.map((row) => ({ _id: row._id, createdAt: row.createdAt }));
  },
});

export const vapidPublicKey = query({
  args: {},
  handler: async () => (pushIsEnabled() ? process.env.VAPID_PUBLIC_KEY ?? null : null),
});

export const forUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!pushIsEnabled()) return [];
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_PUSH_SUBSCRIPTIONS);
  },
});

export const drop = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
