import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { deleteOwnedUpload } from "./lib/uploads";
import { adjustUserStat, ensureUserStats, setUserStat } from "./lib/stats";
import {
  ACCOUNT_DELETION_BATCH,
  ACCOUNT_DELETION_RESUME_BATCH,
  ACCOUNT_DELETION_STALE_MS,
  MAX_PAIR_ROWS,
} from "./lib/limits";
import { enqueueDelivery } from "./lib/delivery";
import { recordOpsState } from "./lib/ops";
import { currentUserId, provisionCurrentUser } from "./lib/authIdentity";
import { takeRate } from "./lib/rate";
import {
  areFriends,
  deleteFriendEdges,
  friendshipForPair,
  hueFromString,
  isBlockedEitherWay,
  isOperator,
  pairKey,
  profileOf,
  requireActiveUser,
} from "./lib/social";

// Public identity. `ensure` runs on every authenticated session boot so a
// profile row always exists before any other social mutation needs it.

export const ensure = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, { displayName }) => {
    const userId = await provisionCurrentUser(ctx);
    const existing = await profileOf(ctx, userId);
    const provided = displayName?.trim();
    if (existing?.deletedAt) throw new Error("This account is closed");
    if (existing) {
      await ensureUserStats(ctx, userId);
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return existing._id; // renames go through profiles.update
    }
    const user = await ctx.db.get(userId);
    const fallback = user?.email?.split("@")[0] ?? "Openbook user";
    if (provided && provided.length > 80) throw new Error("Display name too long (max 80)");
    const resolvedName = (provided || user?.name || fallback).trim().slice(0, 80);
    const profileId = await ctx.db.insert("profiles", {
      userId,
      displayName: resolvedName || "Openbook user",
      avatarHue: hueFromString(userId),
      coverHue: hueFromString([...userId].reverse().join("")),
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await ensureUserStats(ctx, userId, true);
    return profileId;
  },
});

export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
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
    const userId = await currentUserId(ctx);
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
    const viewerId = await requireActiveUser(ctx).catch(() => null);
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
        .take(MAX_PAIR_ROWS);
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
              .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(viewerId, userId)))
              .take(MAX_PAIR_ROWS)
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
    const userId = await currentUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, userId);
    if (!profile) throw new Error("Profile missing — call profiles.ensure first");
    if (profile.deletedAt) throw new Error("This account is closed");
    await takeRate(ctx, userId, "profile");
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
    const viewerId = await requireActiveUser(ctx).catch(() => null);
    if (!viewerId) return [];
    const term = q.trim();
    if (!term) return [];
    const hits = await ctx.db
      .query("profiles")
      .withSearchIndex("search_name", (s) => s.search("displayName", term))
      .take(16);
    const visible = [];
    for (const profile of hits) {
      if (visible.length >= 8) break;
      if (profile.deletedAt) continue;
      if (await isBlockedEitherWay(ctx, viewerId, profile.userId)) continue;
      visible.push(profile);
    }
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

const ACCOUNT_DELETION_PHASES = [
  "auth_sessions",
  "auth_accounts",
  "deliveries",
  "external_identity",
  "messages",
  "comments",
  "reactions",
  "posts",
  "saved",
  "friendships_requester_pending",
  "friendships_requester_accepted",
  "friendships_addressee_pending",
  "friendships_addressee_accepted",
  "friend_edges_owned",
  "friend_edges_referencing",
  "pair_locks_a",
  "pair_locks_b",
  "notifications_incoming",
  "notifications_outgoing",
  "blocks_outgoing",
  "blocks_incoming",
  "mutes_outgoing",
  "mutes_incoming",
  "stories",
  "groups",
  "memberships",
  "hosted_events",
  "rsvps",
  "reports_created",
  "reports_targeted",
  "push",
  "albums",
  "conversation_memberships",
  "conversation_typing",
  "rate_limits",
  "upload_grants",
  "user_stats",
  "subscriptions",
  "uploads",
  "complete",
] as const;

type AccountDeletionPhase = (typeof ACCOUNT_DELETION_PHASES)[number];

function nextDeletionPhase(phase: AccountDeletionPhase): AccountDeletionPhase {
  const index = ACCOUNT_DELETION_PHASES.indexOf(phase);
  return ACCOUNT_DELETION_PHASES[Math.min(index + 1, ACCOUNT_DELETION_PHASES.length - 1)] ?? "complete";
}

async function scheduleDeletion(
  ctx: MutationCtx,
  job: Doc<"accountDeletionJobs">,
  phase: AccountDeletionPhase,
  delayMs = 0,
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(job._id, {
    phase,
    updatedAt: now,
    lastAttemptAt: now,
    failureCount: 0,
    lastError: undefined,
  });
  await ctx.scheduler.runAfter(delayMs, internal.profiles.deleteAccountBatch, {
    userId: job.userId,
  });
}

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await currentUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, me);
    if (!profile) return null;

    const existingJob = await ctx.db
      .query("accountDeletionJobs")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .unique();
    if (profile.deletedAt) {
      if (existingJob && !existingJob.completedAt) {
        await ctx.scheduler.runAfter(0, internal.profiles.deleteAccountBatch, { userId: me });
      }
      return existingJob?._id ?? null;
    }

    const now = Date.now();
    const user = await ctx.db.get(me);
    const authIdentifiers = [
      (user as { email?: string } | null)?.email,
      (user as { phone?: string } | null)?.phone,
    ].filter((value): value is string => Boolean(value));
    for (const identifier of authIdentifiers) {
      const rows = await ctx.db
        .query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", identifier))
        .take(MAX_PAIR_ROWS);
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.patch(profile._id, {
      displayName: "Deleted account",
      bio: "",
      work: "",
      location: "",
      deletedAt: now,
    });
    await ctx.db.patch(me, {
      name: "Deleted account",
      email: undefined,
      emailVerificationTime: undefined,
      phone: undefined,
      phoneVerificationTime: undefined,
      image: undefined,
    });
    await setUserStat(ctx, me, "postCount", 0, true);
    await setUserStat(ctx, me, "notificationUnreadCount", 0, true);
    await setUserStat(ctx, me, "messageUnreadCount", 0, true);
    await setUserStat(ctx, me, "friendCount", 0, true);

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .unique();
    if (subscription?.stripeSubscriptionId) {
      await enqueueDelivery(
        ctx,
        `stripe-cancel:${subscription.stripeSubscriptionId}`,
        {
          kind: "stripe_cancel",
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        },
        me,
      );
      await ctx.db.patch(subscription._id, {
        status: "canceled",
        plan: "free",
        updatedAt: now,
      });
    }

    const jobId = existingJob?._id ?? await ctx.db.insert("accountDeletionJobs", {
      userId: me,
      phase: "auth_sessions",
      requestedAt: now,
      updatedAt: now,
      failureCount: 0,
      lastAttemptAt: now,
    });
    if (existingJob) {
      await ctx.db.patch(existingJob._id, {
        phase: existingJob.completedAt ? "complete" : existingJob.phase,
        updatedAt: now,
        failureCount: 0,
        lastAttemptAt: now,
        lastError: undefined,
      });
    }
    await recordOpsState(ctx, "account-deletion", "ok", "account cleanup queued");
    await ctx.scheduler.runAfter(0, internal.profiles.deleteAccountBatch, { userId: me });
    return jobId;
  },
});

export const deleteAccountBatch = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const job = await ctx.db
      .query("accountDeletionJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!job || job.completedAt) return { outcome: "complete" as const };
    if (!ACCOUNT_DELETION_PHASES.includes(job.phase as AccountDeletionPhase)) {
      await ctx.db.patch(job._id, {
        lastError: "unknown account deletion phase",
        updatedAt: Date.now(),
      });
      await recordOpsState(ctx, "account-deletion", "error", "unknown cleanup phase");
      return { outcome: "error" as const };
    }
    const phase = job.phase as AccountDeletionPhase;
    const again = async (delayMs = 0) => {
      await scheduleDeletion(ctx, job, phase, delayMs);
      return { outcome: "running" as const, phase };
    };
    const advance = async () => {
      const next = nextDeletionPhase(phase);
      await scheduleDeletion(ctx, job, next);
      return { outcome: "running" as const, phase: next };
    };

    try {
      switch (phase) {
      case "auth_sessions": {
        const session = await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .first();
        if (!session) return await advance();
        const tokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
          .take(ACCOUNT_DELETION_BATCH);
        const verifiers = await ctx.db
          .query("authVerifiers")
          .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
          .take(ACCOUNT_DELETION_BATCH);
        for (const token of tokens) await ctx.db.delete(token._id);
        for (const verifier of verifiers) await ctx.db.delete(verifier._id);
        if (tokens.length === 0 && verifiers.length === 0) await ctx.db.delete(session._id);
        return await again();
      }
      case "auth_accounts": {
        const account = await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
          .first();
        if (!account) return await advance();
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", account._id))
          .take(ACCOUNT_DELETION_BATCH);
        for (const code of codes) await ctx.db.delete(code._id);
        if (codes.length === 0) await ctx.db.delete(account._id);
        return await again();
      }
      case "deliveries": {
        const rows = await ctx.db
          .query("deliveryJobs")
          .withIndex("by_subject", (q) => q.eq("subjectUserId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          if (row.payload.kind === "stripe_cancel") {
            // Billing cancellation is required after the user record is erased.
            // Remove the ownership link, but keep the provider operation.
            await ctx.db.patch(row._id, {
              subjectUserId: undefined,
              updatedAt: Date.now(),
            });
          } else {
            // Deleting the row also makes an in-flight worker's terminal write
            // a no-op. The provider call cannot be recalled after it starts.
            await ctx.db.delete(row._id);
          }
        }
        return await again();
      }
      case "external_identity": {
        const rows = await ctx.db
          .query("externalIdentities")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          await enqueueDelivery(ctx, `clerk-delete:${row.providerUserId}`, {
            kind: "clerk_delete",
            clerkUserId: row.providerUserId,
          });
        }
        await ctx.scheduler.runAfter(0, internal.delivery.dispatch, {});
        return await again(5_000);
      }
      case "messages": {
        const rows = await ctx.db
          .query("messages")
          .withIndex("by_sender", (q) => q.eq("senderId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        const conversations = new Set<Id<"conversations">>();
        for (const message of rows) {
          conversations.add(message.conversationId);
          const members = await ctx.db
            .query("conversationMembers")
            .withIndex("by_conversation_user", (q) =>
              q.eq("conversationId", message.conversationId),
            )
            .take(MAX_PAIR_ROWS);
          for (const member of members) {
            if (
              member.userId !== userId &&
              member.unreadCount > 0 &&
              message.createdAt > (member.lastReadAt ?? 0)
            ) {
              await ctx.db.patch(member._id, {
                unreadCount: Math.max(0, member.unreadCount - 1),
              });
              const stats = await ensureUserStats(ctx, member.userId);
              await ctx.db.patch(stats._id, {
                messageUnreadCount: Math.max(0, stats.messageUnreadCount - 1),
                updatedAt: Date.now(),
              });
            }
          }
          await ctx.db.delete(message._id);
        }
        for (const conversationId of conversations) {
          const conversation = await ctx.db.get(conversationId);
          if (!conversation) continue;
          const latest = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .first();
          await ctx.db.patch(conversationId, {
            lastMessageAt: latest?.createdAt ?? conversation.lastMessageAt,
            lastMessageBody: latest?.body ?? "",
            lastSenderId: latest?.senderId,
          });
        }
        return await again();
      }
      case "comments": {
        const rows = await ctx.db
          .query("comments")
          .withIndex("by_author", (q) => q.eq("authorId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const comment of rows) {
          const post = await ctx.db.get(comment.postId);
          await ctx.db.delete(comment._id);
          if (post) {
            await ctx.db.patch(post._id, {
              commentCount: Math.max(0, post.commentCount - 1),
            });
          }
        }
        return await again();
      }
      case "reactions": {
        const rows = await ctx.db
          .query("reactions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const reaction of rows) {
          const post = await ctx.db.get(reaction.postId);
          await ctx.db.delete(reaction._id);
          if (post) {
            const counts = { ...post.reactionCounts };
            counts[reaction.kind] = Math.max(0, counts[reaction.kind] - 1);
            await ctx.db.patch(post._id, { reactionCounts: counts });
          }
        }
        return await again();
      }
      case "posts": {
        const rows = await ctx.db
          .query("posts")
          .withIndex("by_author", (q) => q.eq("authorId", userId))
          .take(Math.min(10, ACCOUNT_DELETION_BATCH));
        if (rows.length === 0) return await advance();
        for (const post of rows) {
          if (!post.deletedAt) {
            await ctx.db.patch(post._id, { deletedAt: Date.now(), body: "" });
          }
          await ctx.scheduler.runAfter(0, internal.posts.purgeDeletedBatch, {
            postId: post._id,
          });
        }
        return await again(250);
      }
      case "saved": {
        const rows = await ctx.db
          .query("savedPosts")
          .withIndex("by_user_created", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "friendships_requester_pending":
      case "friendships_requester_accepted": {
        const status = phase.endsWith("pending") ? "pending" as const : "accepted" as const;
        const rows = await ctx.db
          .query("friendships")
          .withIndex("by_requester_status", (q) =>
            q.eq("requesterId", userId).eq("status", status),
          )
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          if (status === "accepted") {
            await deleteFriendEdges(ctx, row.requesterId, row.addresseeId);
          }
          await ctx.db.delete(row._id);
          if (status === "accepted") {
            await adjustUserStat(ctx, row.addresseeId, "friendCount", -1);
          }
        }
        return await again();
      }
      case "friendships_addressee_pending":
      case "friendships_addressee_accepted": {
        const status = phase.endsWith("pending") ? "pending" as const : "accepted" as const;
        const rows = await ctx.db
          .query("friendships")
          .withIndex("by_addressee_status", (q) =>
            q.eq("addresseeId", userId).eq("status", status),
          )
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          if (status === "accepted") {
            await deleteFriendEdges(ctx, row.requesterId, row.addresseeId);
          }
          await ctx.db.delete(row._id);
          if (status === "accepted") {
            await adjustUserStat(ctx, row.requesterId, "friendCount", -1);
          }
        }
        return await again();
      }
      case "friend_edges_owned": {
        const rows = await ctx.db
          .query("friendEdges")
          .withIndex("by_user_created", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "friend_edges_referencing": {
        const rows = await ctx.db
          .query("friendEdges")
          .withIndex("by_friend", (q) => q.eq("friendId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "pair_locks_a": {
        const rows = await ctx.db
          .query("pairLocks")
          .withIndex("by_user_a", (q) => q.eq("userA", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "pair_locks_b": {
        const rows = await ctx.db
          .query("pairLocks")
          .withIndex("by_user_b", (q) => q.eq("userB", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "notifications_incoming": {
        const rows = await ctx.db
          .query("notifications")
          .withIndex("by_user_created", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "notifications_outgoing": {
        const rows = await ctx.db
          .query("notifications")
          .withIndex("by_actor", (q) => q.eq("actorId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        const unreadByUser = new Map<Id<"users">, number>();
        for (const row of rows) {
          if (!row.read) unreadByUser.set(row.userId, (unreadByUser.get(row.userId) ?? 0) + 1);
          await ctx.db.delete(row._id);
        }
        for (const [recipientId, count] of unreadByUser) {
          await adjustUserStat(ctx, recipientId, "notificationUnreadCount", -count);
        }
        return await again();
      }
      case "blocks_outgoing": {
        const rows = await ctx.db
          .query("blocks")
          .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "blocks_incoming": {
        const rows = await ctx.db
          .query("blocks")
          .withIndex("by_blocked", (q) => q.eq("blockedId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "mutes_outgoing": {
        const rows = await ctx.db
          .query("mutes")
          .withIndex("by_muter", (q) => q.eq("muterId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "mutes_incoming": {
        const rows = await ctx.db
          .query("mutes")
          .withIndex("by_muted", (q) => q.eq("mutedId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "stories": {
        const rows = await ctx.db
          .query("stories")
          .withIndex("by_author", (q) => q.eq("authorId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const story of rows) {
          if (story.imageId) await deleteOwnedUpload(ctx, userId, story.imageId);
          await ctx.db.delete(story._id);
        }
        return await again();
      }
      case "groups": {
        const group = await ctx.db
          .query("groups")
          .withIndex("by_creator", (q) => q.eq("creatorId", userId))
          .first();
        if (!group) return await advance();
        const members = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .take(2);
        const replacement = members.find((member) => member.userId !== userId);
        if (replacement) {
          await ctx.db.patch(replacement._id, { role: "owner" });
          await ctx.db.patch(group._id, { creatorId: replacement.userId });
          return await again();
        }
        const posts = await ctx.db
          .query("posts")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .take(10);
        if (posts.length > 0) {
          for (const post of posts) {
            if (!post.deletedAt) await ctx.db.patch(post._id, { deletedAt: Date.now(), body: "" });
            await ctx.scheduler.runAfter(0, internal.posts.purgeDeletedBatch, {
              postId: post._id,
            });
          }
          return await again(250);
        }
        for (const member of members) await ctx.db.delete(member._id);
        await ctx.db.delete(group._id);
        return await again();
      }
      case "memberships": {
        const rows = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          const group = await ctx.db.get(row.groupId);
          await ctx.db.delete(row._id);
          if (group) {
            await ctx.db.patch(group._id, {
              memberCount: Math.max(0, (group.memberCount ?? 1) - 1),
            });
          }
        }
        return await again();
      }
      case "hosted_events": {
        const event = await ctx.db
          .query("events")
          .withIndex("by_host", (q) => q.eq("hostId", userId))
          .first();
        if (!event) return await advance();
        if (!event.canceledAt) await ctx.db.patch(event._id, { canceledAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.events.deleteCanceledBatch, {
          eventId: event._id,
        });
        return await again(250);
      }
      case "rsvps": {
        const rows = await ctx.db
          .query("eventRsvps")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          const event = await ctx.db.get(row.eventId);
          await ctx.db.delete(row._id);
          if (event) {
            await ctx.db.patch(event._id, {
              goingCount: Math.max(0, (event.goingCount ?? 0) - (row.status === "going" ? 1 : 0)),
              interestedCount: Math.max(
                0,
                (event.interestedCount ?? 0) - (row.status === "interested" ? 1 : 0),
              ),
            });
          }
        }
        return await again();
      }
      case "reports_created": {
        const rows = await ctx.db
          .query("reports")
          .withIndex("by_reporter", (q) => q.eq("reporterId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "reports_targeted": {
        const rows = await ctx.db
          .query("reports")
          .withIndex("by_target_user", (q) => q.eq("targetUserId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) {
          // Keep the moderation record, but remove the deleted user's link.
          await ctx.db.patch(row._id, { targetUserId: undefined });
        }
        return await again();
      }
      case "push": {
        const rows = await ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "albums": {
        const album = await ctx.db
          .query("albums")
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .first();
        if (!album) return await advance();
        const items = await ctx.db
          .query("albumItems")
          .withIndex("by_album", (q) => q.eq("albumId", album._id))
          .take(ACCOUNT_DELETION_BATCH);
        for (const item of items) {
          await deleteOwnedUpload(ctx, userId, item.imageId);
          await ctx.db.delete(item._id);
        }
        if (items.length === 0) await ctx.db.delete(album._id);
        return await again();
      }
      case "conversation_memberships": {
        const rows = await ctx.db
          .query("conversationMembers")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "conversation_typing": {
        const rows = await ctx.db
          .query("conversationTyping")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "rate_limits": {
        const rows = await ctx.db
          .query("rateLimits")
          .withIndex("by_user_action", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "upload_grants": {
        const rows = await ctx.db
          .query("uploadGrants")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "user_stats": {
        const rows = await ctx.db
          .query("userStats")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(MAX_PAIR_ROWS);
        if (rows.length === 0) return await advance();
        for (const row of rows) await ctx.db.delete(row._id);
        return await again();
      }
      case "subscriptions": {
        const subscription = await ctx.db
          .query("subscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique();
        if (!subscription) return await advance();
        if (subscription.stripeSubscriptionId) {
          await enqueueDelivery(
            ctx,
            `stripe-cancel:${subscription.stripeSubscriptionId}`,
            {
              kind: "stripe_cancel",
              stripeSubscriptionId: subscription.stripeSubscriptionId,
            },
          );
        }
        await ctx.db.delete(subscription._id);
        return await again();
      }
      case "uploads": {
        const rows = await ctx.db
          .query("uploads")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(ACCOUNT_DELETION_BATCH);
        if (rows.length === 0) return await advance();
        for (const row of rows) await deleteOwnedUpload(ctx, userId, row.storageId);
        return await again();
      }
      case "complete": {
        const now = Date.now();
        await ctx.db.patch(job._id, {
          phase: "complete",
          completedAt: now,
          updatedAt: now,
          lastError: undefined,
        });
        await recordOpsState(ctx, "account-deletion", "ok", "account cleanup completed");
        return { outcome: "complete" as const };
      }
      }
    } catch (error) {
      const now = Date.now();
      const failureCount = (job.failureCount ?? 0) + 1;
      const message = (error instanceof Error ? error.message : "account cleanup failed")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 240);
      await ctx.db.patch(job._id, {
        updatedAt: now,
        lastAttemptAt: now,
        failureCount,
        lastError: message,
      });
      await recordOpsState(
        ctx,
        "account-deletion",
        "error",
        `phase=${phase} failure=${failureCount}`,
      );
      const delayMs = Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(failureCount - 1, 8));
      await ctx.scheduler.runAfter(delayMs, internal.profiles.deleteAccountBatch, { userId });
      return { outcome: "retrying" as const, phase, delayMs };
    }
  },
});

// Cron watchdog for scheduler loss, deploy interruption, or a transient failure.
// A job that is making progress updates updatedAt and is not duplicated here.
export const resumeAccountDeletions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("accountDeletionJobs")
      .withIndex("by_completed_updated", (q) =>
        q.eq("completedAt", undefined).lt("updatedAt", now - ACCOUNT_DELETION_STALE_MS),
      )
      .take(ACCOUNT_DELETION_RESUME_BATCH);
    for (const row of rows) {
      await ctx.db.patch(row._id, { updatedAt: now, lastAttemptAt: now });
      await ctx.scheduler.runAfter(0, internal.profiles.deleteAccountBatch, {
        userId: row.userId,
      });
    }
    if (rows.length > 0) {
      await recordOpsState(ctx, "account-deletion", "error", `rescheduled=${rows.length}`);
    }
    return { rescheduled: rows.length };
  },
});
