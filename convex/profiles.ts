import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { deleteOwnedUpload } from "./lib/uploads";
import {
  areFriends,
  blockedPairIds,
  friendshipForPair,
  hueFromString,
  isOperator,
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
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return existing._id; // renames go through profiles.update
    }
    const user = await ctx.db.get(userId);
    const fallback = user?.email?.split("@")[0] ?? "Openbook user";
    return await ctx.db.insert("profiles", {
      userId,
      displayName: provided || user?.name || fallback,
      avatarHue: hueFromString(userId),
      coverHue: hueFromString([...userId].reverse().join("")),
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});

export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await profileOf(ctx, userId);
    if (!profile || profile.deletedAt) return null;
    await ctx.db.patch(profile._id, { lastSeenAt: Date.now() });
    return profile._id;
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await profileOf(ctx, userId);
    if (!profile) return null;
    const user = await ctx.db.get(userId);
    const email = (user as { email?: string } | null)?.email ?? null;
    if (profile.deletedAt) {
      return {
        ...profile,
        isMe: true,
        deleted: true as const,
        email,
        isOperator: false,
      };
    }
    return {
      ...profile,
      isMe: true,
      deleted: false as const,
      email,
      isOperator: isOperator(userId),
    };
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
      if (theyBlocked) return null;
      if (iBlocked) relationship = "blocked";
      else {
        const edge = await friendshipForPair(ctx, viewerId, userId);
        if (edge?.status === "accepted") relationship = "friends";
        else if (edge?.status === "pending")
          relationship =
            edge.requesterId === viewerId ? "outgoing_request" : "incoming_request";
      }
    }
    const hideBio =
      userId !== viewerId &&
      profile.bioAudience === "friends" &&
      relationship !== "friends";
    const muted =
      userId !== viewerId
        ? (
            await ctx.db
              .query("mutes")
              .withIndex("by_muter", (q) => q.eq("muterId", viewerId))
              .collect()
          ).some((row) => row.mutedId === userId)
        : false;
    return {
      ...profile,
      isMe: userId === viewerId,
      relationship,
      muted,
      bio: hideBio ? undefined : profile.bio,
      work: hideBio ? undefined : profile.work,
      location: hideBio ? undefined : profile.location,
    };
  },
});

export const update = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    work: v.optional(v.string()),
    location: v.optional(v.string()),
    bioAudience: v.optional(v.union(v.literal("public"), v.literal("friends"))),
    friendsListPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, userId);
    if (!profile) throw new Error("Profile missing — call profiles.ensure first");
    if (profile.deletedAt) throw new Error("This account is closed");
    const patch: Record<string, string | boolean> = {};
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
    if (args.bioAudience !== undefined) patch.bioAudience = args.bioAudience;
    if (args.friendsListPublic !== undefined) {
      (patch as { friendsListPublic?: boolean }).friendsListPublic = args.friendsListPublic;
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

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", me))
      .collect();
    for (const session of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .unique();
    if (sub?.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.billing.cancelAtStripe, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
    }

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
      const saves = await ctx.db
        .query("savedPosts")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .collect();
      for (const save of saves) await ctx.db.delete(save._id);
      const mediaIds = [
        ...(post.imageIds ?? []),
        ...(post.imageId ? [post.imageId] : []),
        ...(post.videoId ? [post.videoId] : []),
      ];
      for (const storageId of new Set(mediaIds)) {
        await deleteOwnedUpload(ctx, me, storageId);
      }
      await ctx.db.delete(post._id);
    }

    const mySavedPosts = await ctx.db
      .query("savedPosts")
      .withIndex("by_user_created", (q) => q.eq("userId", me))
      .collect();
    for (const save of mySavedPosts) await ctx.db.delete(save._id);

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

    const myMutes = await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q) => q.eq("muterId", me))
      .collect();
    for (const row of myMutes) await ctx.db.delete(row._id);

    const myStories = await ctx.db
      .query("stories")
      .withIndex("by_author", (q) => q.eq("authorId", me))
      .collect();
    for (const story of myStories) {
      if (story.imageId) await ctx.storage.delete(story.imageId).catch(() => undefined);
      await ctx.db.delete(story._id);
    }

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const row of memberships) await ctx.db.delete(row._id);

    const hosted = await ctx.db
      .query("events")
      .withIndex("by_host", (q) => q.eq("hostId", me))
      .collect();
    for (const event of hosted) {
      const rsvps = await ctx.db
        .query("eventRsvps")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      for (const rsvp of rsvps) await ctx.db.delete(rsvp._id);
      await ctx.db.delete(event._id);
    }
    const myRsvps = await ctx.db
      .query("eventRsvps")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const row of myRsvps) await ctx.db.delete(row._id);

    const myReports = await ctx.db
      .query("reports")
      .withIndex("by_reporter", (q) => q.eq("reporterId", me))
      .collect();
    for (const row of myReports) await ctx.db.delete(row._id);

    const pushes = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const row of pushes) await ctx.db.delete(row._id);

    const myUploads = await ctx.db
      .query("uploads")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const row of myUploads) {
      if (!row.used) await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }

    const memberRows = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    for (const member of memberRows) {
      const conversation = await ctx.db.get(member.conversationId);
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", member.conversationId),
        )
        .collect();
      for (const message of messages) {
        if (message.senderId === me) await ctx.db.delete(message._id);
      }
      await ctx.db.delete(member._id);
      if (conversation) {
        const others = await ctx.db
          .query("conversationMembers")
          .withIndex("by_conversation_user", (q) =>
            q.eq("conversationId", conversation._id),
          )
          .collect();
        if (others.length === 0) await ctx.db.delete(conversation._id);
      }
    }

    const rates = await ctx.db
      .query("rateLimits")
      .withIndex("by_user_action", (q) => q.eq("userId", me))
      .collect();
    for (const row of rates) await ctx.db.delete(row._id);

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
