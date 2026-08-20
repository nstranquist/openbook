import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorCard, requireActiveUser } from "./lib/social";
import { takeRate } from "./lib/rate";

export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    startAt: v.number(),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { title, description, startAt, groupId }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title required");
    if (!Number.isFinite(startAt)) throw new Error("Start time required");
    if (groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", me),
        )
        .unique();
      if (!membership) throw new Error("Group not found");
    }
    await takeRate(ctx, me, "event");
    const eventId = await ctx.db.insert("events", {
      title: trimmed.slice(0, 120),
      description: description.trim().slice(0, 1000),
      startAt,
      hostId: me,
      groupId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("eventRsvps", {
      eventId,
      userId: me,
      status: "going",
      createdAt: Date.now(),
    });
    return eventId;
  },
});

export const rsvp = mutation({
  args: {
    eventId: v.id("events"),
    status: v.union(v.literal("going"), v.literal("interested")),
  },
  handler: async (ctx, { eventId, status }) => {
    const me = await requireActiveUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");
    const existing = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", me))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { status });
      return existing._id;
    }
    return await ctx.db.insert("eventRsvps", {
      eventId,
      userId: me,
      status,
      createdAt: Date.now(),
    });
  },
});

export const cancel = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const me = await requireActiveUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.hostId !== me) throw new Error("Event not found");
    const rsvps = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const row of rsvps) await ctx.db.delete(row._id);
    await ctx.db.delete(eventId);
  },
});

export const upcoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const now = Date.now();
    const rows = await ctx.db.query("events").withIndex("by_start").order("asc").take(40);
    return await Promise.all(
      rows
        .filter((e) => e.startAt >= now - 3_600_000)
        .map(async (e) => {
          const rsvps = await ctx.db
            .query("eventRsvps")
            .withIndex("by_event", (q) => q.eq("eventId", e._id))
            .collect();
          const mine = rsvps.find((r) => r.userId === me);
          return {
            ...e,
            host: await authorCard(ctx, e.hostId),
            going: rsvps.filter((r) => r.status === "going").length,
            interested: rsvps.filter((r) => r.status === "interested").length,
            myRsvp: mine?.status ?? null,
            isHost: e.hostId === me,
          };
        }),
    );
  },
});
