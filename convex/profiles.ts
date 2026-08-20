import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  areFriends,
  blockedPairIds,
  friendshipForPair,
  hueFromString,
  pairKey,
  profileOf,
} from "./lib/social";

// Public identity. `ensure` runs on every authenticated session boot so a
// profile row always exists before any other social mutation needs it.

export const ensure = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, { displayName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await profileOf(ctx, userId);
    const provided = displayName?.trim();
    if (existing?.deletedAt) throw new Error("This account is closed");
    if (existing) return existing._id; // renames go through profiles.update
    const user = await ctx.db.get(userId);
    const fallback = user?.email?.split("@")[0] ?? "Openbook user";
    return await ctx.db.insert("profiles", {
      userId,
      displayName: provided || user?.name || fallback,
      avatarHue: hueFromString(userId),
      coverHue: hueFromString([...userId].reverse().join("")),
      joinedAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await profileOf(ctx, userId);
    if (!profile) return null;
    if (profile.deletedAt) return { ...profile, isMe: true, deleted: true as const };
    return { ...profile, isMe: true, deleted: false as const };
  },
});

// A profile page payload: the profile plus the viewer's relationship to it,
// which drives the Add Friend / Respond / Friends button states.
export const view = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return null;
    const profile = await profileOf(ctx, userId);
    if (!profile || profile.deletedAt) return null;
    let relationship:
      | "self"
      | "friends"
      | "outgoing_request"
      | "incoming_request"
      | "blocked"
      | "blocked_by"
      | "none" = "none";
    if (userId === viewerId) relationship = "self";
    else {
      const blocked = await ctx.db
        .query("blocks")
        .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(viewerId, userId)))
        .collect();
      const iBlocked = blocked.some((row) => row.blockerId === viewerId);
      const theyBlocked = blocked.some((row) => row.blockerId === userId);
      if (iBlocked) relationship = "blocked";
      else if (theyBlocked) relationship = "blocked_by";
      else {
        const edge = await friendshipForPair(ctx, viewerId, userId);
        if (edge?.status === "accepted") relationship = "friends";
        else if (edge?.status === "pending")
          relationship =
            edge.requesterId === viewerId ? "outgoing_request" : "incoming_request";
      }
    }
    return { ...profile, isMe: userId === viewerId, relationship };
  },
});

export const update = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    work: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, userId);
    if (!profile) throw new Error("Profile missing — call profiles.ensure first");
    if (profile.deletedAt) throw new Error("This account is closed");
    const patch: Record<string, string> = {};
    if (args.displayName !== undefined) {
      const name = args.displayName.trim();
      if (!name) throw new Error("Display name cannot be empty");
      if (name.length > 80) throw new Error("Display name too long (max 80)");
      patch.displayName = name;
    }
    for (const field of ["bio", "work", "location"] as const) {
      const value = args[field];
      if (value !== undefined) {
        if (value.length > 500) throw new Error(`${field} too long (max 500)`);
        patch[field] = value.trim();
      }
    }
    await ctx.db.patch(profile._id, patch);
  },
});

// Live people search over the full-text index, annotated with friendship state
// so result rows can render the right action.
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return [];
    const term = q.trim();
    if (!term) return [];
    const blocked = await blockedPairIds(ctx, viewerId);
    const hits = await ctx.db
      .query("profiles")
      .withSearchIndex("search_name", (s) => s.search("displayName", term))
      .take(16);
    const visible = hits.filter(
      (p) => !p.deletedAt && !blocked.has(p.userId),
    ).slice(0, 8);
    return await Promise.all(
      visible.map(async (p) => ({
        userId: p.userId,
        displayName: p.displayName,
        avatarHue: p.avatarHue,
        isMe: p.userId === viewerId,
        isFriend: await areFriends(ctx, viewerId, p.userId),
      })),
    );
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, me);
    if (!profile || profile.deletedAt) return;

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", me))
      .collect();
    for (const post of posts) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .collect();
      const reactions = await ctx.db
        .query("reactions")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .collect();
      for (const c of comments) await ctx.db.delete(c._id);
      for (const r of reactions) await ctx.db.delete(r._id);
      const notifs = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", post.authorId))
        .collect();
      for (const n of notifs) {
        if (n.postId === post._id) await ctx.db.delete(n._id);
      }
      if (post.imageId) await ctx.storage.delete(post.imageId);
      await ctx.db.delete(post._id);
    }

    const myComments = await ctx.db
      .query("comments")
      .withIndex("by_author", (q) => q.eq("authorId", me))
      .collect();
    for (const comment of myComments) {
      const post = await ctx.db.get(comment.postId);
      await ctx.db.delete(comment._id);
      if (post)
        await ctx.db.patch(post._id, {
          commentCount: Math.max(0, post.commentCount - 1),
        });
    }

    const myReactions = await ctx.db
      .query("reactions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const reaction of myReactions) {
      const post = await ctx.db.get(reaction.postId);
      await ctx.db.delete(reaction._id);
      if (post) {
        const counts = { ...post.reactionCounts };
        const kind = reaction.kind as keyof typeof counts;
        counts[kind] = Math.max(0, (counts[kind] ?? 0) - 1);
        await ctx.db.patch(post._id, { reactionCounts: counts });
      }
    }

    for (const dir of ["by_requester_status", "by_addressee_status"] as const) {
      for (const status of ["pending", "accepted"] as const) {
        const edges = await ctx.db
          .query("friendships")
          .withIndex(dir, (q) =>
            dir === "by_requester_status"
              ? q.eq("requesterId", me).eq("status", status)
              : q.eq("addresseeId", me).eq("status", status),
          )
          .collect();
        for (const edge of edges) await ctx.db.delete(edge._id);
      }
    }

    const incomingNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me))
      .collect();
    for (const n of incomingNotifs) await ctx.db.delete(n._id);
    const outgoingNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_actor", (q) => q.eq("actorId", me))
      .collect();
    for (const n of outgoingNotifs) await ctx.db.delete(n._id);

    const asBlocker = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect();
    const asBlocked = await ctx.db
      .query("blocks")
      .withIndex("by_blocked", (q) => q.eq("blockedId", me))
      .collect();
    for (const row of [...asBlocker, ...asBlocked]) await ctx.db.delete(row._id);

    const rates = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action", (q) => q.eq("userId", me))
      .collect();
    for (const row of rates) await ctx.db.delete(row._id);

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .unique();
    if (sub) await ctx.db.delete(sub._id);

    await ctx.db.patch(profile._id, {
      displayName: "Deleted account",
      bio: "",
      work: "",
      location: "",
      deletedAt: Date.now(),
    });
  },
});
