import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { authorCard, enrichPost, requireActiveUser } from "./lib/social";
import { takeRate } from "./lib/rate";
import { MAX_GROUPS_PER_USER } from "./lib/limits";
import { boundedPaginationOptions } from "./lib/pagination";

const MEMBER_PREVIEW_LIMIT = 100;

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
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_GROUPS_PER_USER);
    if (memberships.length >= MAX_GROUPS_PER_USER) {
      throw new Error(`Group membership limit reached (${MAX_GROUPS_PER_USER})`);
    }
    const groupId = await ctx.db.insert("groups", {
      name: trimmed.slice(0, 80),
      description: description.trim().slice(0, 500),
      kind,
      creatorId: me,
      createdAt: Date.now(),
      memberCount: 1,
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
    await takeRate(ctx, me, "group_membership");
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (existing) return existing._id;
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_GROUPS_PER_USER);
    if (memberships.length >= MAX_GROUPS_PER_USER) {
      throw new Error(`Group membership limit reached (${MAX_GROUPS_PER_USER})`);
    }
    const membershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: me,
      role: "member",
      createdAt: Date.now(),
    });
    await ctx.db.patch(groupId, { memberCount: (group.memberCount ?? 1) + 1 });
    return membershipId;
  },
});

export const leave = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const me = await requireActiveUser(ctx);
    await takeRate(ctx, me, "group_membership");
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!existing) return;
    if (existing.role === "owner") {
      throw new Error("Transfer ownership before leaving");
    }
    await ctx.db.delete(existing._id);
    const group = await ctx.db.get(groupId);
    if (group) await ctx.db.patch(groupId, { memberCount: Math.max(1, (group.memberCount ?? 2) - 1) });
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
      .take(MAX_GROUPS_PER_USER);
    return await Promise.all(
      memberships.map(async (m) => {
        const group = await ctx.db.get(m.groupId);
        return group ? { ...group, role: m.role } : null;
      }),
    ).then((rows) => rows.filter((r) => r !== null));
  },
});

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    const page = await Promise.all(result.page.map(async (membership) => {
      const group = await ctx.db.get(membership.groupId);
      return group ? { ...group, role: membership.role } : null;
    }));
    return { ...result, page: page.filter((group) => group !== null) };
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
      .take(MAX_GROUPS_PER_USER);
    const mineIds = new Set(mine.map((m) => m.groupId));
    const rows = await ctx.db.query("groups").order("desc").take(40);
    return rows
      .filter((g) => !mineIds.has(g._id))
      .map((g) => ({ ...g, role: null as null }));
  },
});

export const discoverPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const mine = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_GROUPS_PER_USER);
    const mineIds = new Set(mine.map((membership) => membership.groupId));
    const result = await ctx.db
      .query("groups")
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: result.page
        .filter((group) => !mineIds.has(group._id))
        .map((group) => ({ ...group, role: null as null })),
    };
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
      .take(MEMBER_PREVIEW_LIMIT);
    return await Promise.all(
      rows.map(async (m) => ({ ...(await authorCard(ctx, m.userId)), role: m.role })),
    );
  },
});

export const membersPage = query({
  args: { groupId: v.id("groups"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { groupId, paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!membership) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (member) => ({
          ...(await authorCard(ctx, member.userId)),
          role: member.role,
        })),
      ),
    };
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
      .take(40);
    return await Promise.all(
      rows.filter((post) => !post.deletedAt).slice(0, 20).map((post) => enrichPost(ctx, post, me)),
    );
  },
});

export const feedPage = query({
  args: { groupId: v.id("groups"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { groupId, paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", me))
      .unique();
    if (!membership) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("posts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await Promise.all(
        result.page
          .filter((post) => !post.deletedAt)
          .map((post) => enrichPost(ctx, post, me)),
      ),
    };
  },
});
