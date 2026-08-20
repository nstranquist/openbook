import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActiveUser } from "./lib/social";

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, { endpoint, p256dh, auth }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = endpoint.trim();
    if (!trimmed.startsWith("https://")) throw new Error("Invalid push endpoint");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", trimmed))
      .first();
    if (existing) {
      if (existing.userId !== me) throw new Error("Push endpoint in use");
      await ctx.db.patch(existing._id, { p256dh, auth });
      return existing._id;
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
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(8);
  },
});
