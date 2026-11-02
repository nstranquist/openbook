import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { authorCard, requireActiveUser } from "./lib/social";
import { takeRate } from "./lib/rate";
import { boundedPaginationOptions } from "./lib/pagination";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const EVENT_GRACE_MS = 60 * 60 * 1000;

async function visibleEvents(
  ctx: QueryCtx,
  me: Id<"users">,
  rows: Doc<"events">[],
): Promise<Doc<"events">[]> {
  const groupMembership = new Map<string, Promise<boolean>>();
  const visibility = await Promise.all(
    rows.map(async (event) => {
      if (!event.groupId) return true;
      let visible = groupMembership.get(event.groupId);
      if (!visible) {
        visible = ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", event.groupId!).eq("userId", me),
          )
          .unique()
          .then((membership) => membership !== null);
        groupMembership.set(event.groupId, visible);
      }
      return await visible;
    }),
  );
  return rows.filter((event, index) => visibility[index] && !event.canceledAt);
}

async function enrichEvents(ctx: QueryCtx, me: Id<"users">, rows: Doc<"events">[]) {
  return await Promise.all(
    rows.map(async (event) => {
      const mine = await ctx.db
        .query("eventRsvps")
        .withIndex("by_event_user", (q) => q.eq("eventId", event._id).eq("userId", me))
        .unique();
      return {
        ...event,
        host: await authorCard(ctx, event.hostId),
        going: event.goingCount ?? 0,
        interested: event.interestedCount ?? 0,
        myRsvp: mine?.status ?? null,
        isHost: event.hostId === me,
      };
    }),
  );
}

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
      goingCount: 1,
      interestedCount: 0,
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
    await takeRate(ctx, me, "rsvp");
    const event = await ctx.db.get(eventId);
    if (!event || event.canceledAt) throw new Error("Event not found");
    if (event.groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", event.groupId!).eq("userId", me),
        )
        .unique();
      if (!membership) throw new Error("Event not found");
    }
    const existing = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", me))
      .unique();
    if (existing) {
      if (existing.status === status) return existing._id;
      await ctx.db.patch(existing._id, { status });
      await ctx.db.patch(eventId, {
        goingCount: Math.max(0, (event.goingCount ?? 0) + (status === "going" ? 1 : -1)),
        interestedCount: Math.max(
          0,
          (event.interestedCount ?? 0) + (status === "interested" ? 1 : -1),
        ),
      });
      return existing._id;
    }
    const rsvpId = await ctx.db.insert("eventRsvps", {
      eventId,
      userId: me,
      status,
      createdAt: Date.now(),
    });
    await ctx.db.patch(eventId, {
      goingCount: (event.goingCount ?? 0) + (status === "going" ? 1 : 0),
      interestedCount: (event.interestedCount ?? 0) + (status === "interested" ? 1 : 0),
    });
    return rsvpId;
  },
});

export const cancel = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const me = await requireActiveUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.hostId !== me) throw new Error("Event not found");
    if (event.canceledAt) return;
    await ctx.db.patch(eventId, { canceledAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.events.deleteCanceledBatch, { eventId });
  },
});

export const upcoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startAt", now - EVENT_GRACE_MS))
      .order("asc")
      .take(200);
    return await enrichEvents(ctx, me, (await visibleEvents(ctx, me, rows)).slice(0, 40));
  },
});

export const upcomingPage = query({
  args: { anchorAt: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { anchorAt, paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const current = Date.now();
    if (!Number.isFinite(anchorAt) || anchorAt < 0 || anchorAt > current + 5 * 60_000) {
      throw new Error("Invalid event page anchor");
    }
    const result = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startAt", anchorAt - EVENT_GRACE_MS))
      .order("asc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await enrichEvents(ctx, me, await visibleEvents(ctx, me, result.page)),
    };
  },
});

export const deleteCanceledBatch = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event?.canceledAt) return;
    const rows = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100) {
      await ctx.scheduler.runAfter(0, internal.events.deleteCanceledBatch, { eventId });
    } else {
      await ctx.db.delete(eventId);
    }
  },
});
