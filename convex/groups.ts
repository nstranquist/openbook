import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorCard, enrichPost, requireActiveUser } from "./lib/social";
import { takeRate } from "./lib/rate";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    kind: v.union(v.literal("group"), v.literal("page")),
  },
  handler: async (ctx, { name, description, kind }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name required");
    await takeRate(ctx, me, "group");
    const groupId = await ctx.db.insert("groups", {
      name: trimmed.slice(0, 80),
      description: description.trim().slice(0, 500),
      kind,
      creatorId: me,
      createdAt: Date.now(),
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: me,
      role: "owner",
      createdAt: Date.now(),
    });
    return groupId;
  },
});

export const join = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx);
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("groupMembers", {
      groupId,
      userId: me,
      role: "member",
      createdAt: Date.now(),
    });
  },
});

export const leave = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx);
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!existing) return;
    if (existing.role === "owner") {
      throw new Error("Transfer ownership before leaving");
    }
    await ctx.db.delete(existing._id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    return await Promise.all(
      memberships.map(async (m) => {
        const group = await ctx.db.get(m.groupId);
        return group ? { ...group, role: m.role } : null;
      }),
    ).then((rows) => rows.filter((r) => r !== null));
  },
});

export const discover = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const mine = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    const mineIds = new Set(mine.map((m) => m.groupId));
    const rows = await ctx.db.query("groups").order("desc").take(40);
    return rows
      .filter((g) => !mineIds.has(g._id))
      .map((g) => ({ ...g, role: null as null }));
  },
});

export const get = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return null;
    const group = await ctx.db.get(groupId);
    if (!group) return null;
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    return { ...group, role: membership?.role ?? null };
  },
});

export const members = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!membership) return [];
    const rows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    return await Promise.all(
      rows.map(async (m) => ({ ...(await authorCard(ctx, m.userId)), role: m.role })),
    );
  },
});

export const feed = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!membership) return [];
    const rows = await ctx.db
      .query("posts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("desc")
      .take(20);
    return await Promise.all(rows.map((p) => enrichPost(ctx, p, me)));
  },
});
