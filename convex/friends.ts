import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  areFriends,
  authorCard,
  collapseDuplicatePairRows,
  deleteFriendEdges,
  deleteNotificationsBetween,
  ensureFriendEdges,
  friendIdsOf,
  friendshipForPair,
  isBlockedEitherWay,
  notify,
  occupyPair,
  pairKey,
  profileOf,
  requireActiveProfile,
  requireActiveUser,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { adjustUserStat, userStats } from "./lib/stats";
import { boundedPaginationOptions } from "./lib/pagination";
import {
  MAX_FRIENDS,
  MAX_FRIEND_LIST_RESULTS,
  MAX_PENDING_FRIEND_REQUESTS,
  MAX_SUGGESTION_FRIENDS_PER_SEED,
  MAX_SUGGESTION_SEED_FRIENDS,
} from "./lib/limits";

// Friend-graph lifecycle. One friendships row per pair: pending → accepted,
// or deleted (decline/cancel/unfriend). Every transition fans out the right
// notification and nothing else.

async function assertFriendCapacity(
  ctx: MutationCtx,
  ...userIds: Id<"users">[]
): Promise<void> {
  for (const userId of userIds) {
    const stats = await userStats(ctx, userId);
    if (!stats?.friendCountExact) {
      throw new Error("Friend statistics migration is incomplete");
    }
    if ((stats.friendCount ?? 0) >= MAX_FRIENDS) {
      throw new Error(`Friend limit reached (${MAX_FRIENDS})`);
    }
  }
}

async function adjustFriendCounts(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
  delta: number,
): Promise<void> {
  await adjustUserStat(ctx, a, "friendCount", delta);
  await adjustUserStat(ctx, b, "friendCount", delta);
}

export const sendRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId: addresseeId }) => {
    const requesterId = await requireActiveUser(ctx);
    if (requesterId === addresseeId)
      throw new Error("You cannot friend yourself");
    const addressee = await profileOf(ctx, addresseeId);
    if (!addressee || addressee.deletedAt) throw new Error("User not found");
    if (await isBlockedEitherWay(ctx, requesterId, addresseeId))
      throw new Error("You cannot send a friend request to this user");
    await takeRate(ctx, requesterId, "friend_request");
    const existing = await friendshipForPair(ctx, requesterId, addresseeId);
    if (existing?.status === "accepted")
      throw new Error("Already friends");
    if (existing?.status === "pending") {
      // The other side already asked — treat a cross-request as an accept.
      if (existing.addresseeId === requesterId) {
        await assertFriendCapacity(ctx, requesterId, existing.requesterId);
        const respondedAt = Date.now();
        await ctx.db.patch(existing._id, {
          status: "accepted",
          respondedAt,
        });
        await ensureFriendEdges(
          ctx,
          existing._id,
          requesterId,
          existing.requesterId,
          respondedAt,
        );
        await adjustFriendCounts(ctx, requesterId, existing.requesterId, 1);
        await deleteNotificationsBetween(ctx, requesterId, existing.requesterId, [
          "friend_request",
        ]);
        await notify(ctx, {
          userId: existing.requesterId,
          actorId: requesterId,
          kind: "friend_accept",
        });
        return existing._id;
      }
      throw new Error("Request already sent");
    }
    const outgoing = await ctx.db
      .query("friendships")
      .withIndex("by_requester_status", (q) =>
        q.eq("requesterId", requesterId).eq("status", "pending"),
      )
      .take(MAX_PENDING_FRIEND_REQUESTS);
    if (outgoing.length >= MAX_PENDING_FRIEND_REQUESTS) {
      throw new Error(`Pending friend request limit reached (${MAX_PENDING_FRIEND_REQUESTS})`);
    }
    const key = pairKey(requesterId, addresseeId);
    await occupyPair(ctx, "friendship", key);
    const id = await ctx.db.insert("friendships", {
      requesterId,
      addresseeId,
      status: "pending",
      pairKey: key,
      createdAt: Date.now(),
    });
    const kept = await collapseDuplicatePairRows(ctx, "friendships", key);
    await notify(ctx, {
      userId: addresseeId,
      actorId: requesterId,
      kind: "friend_request",
    });
    return kept && "_id" in kept ? kept._id : id;
  },
});

export const accept = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId: requesterId }) => {
    const me = await requireActiveUser(ctx);
    const requester = await profileOf(ctx, requesterId);
    if (!requester || requester.deletedAt) throw new Error("User not found");
    const edge = await friendshipForPair(ctx, me, requesterId);
    if (!edge || edge.status !== "pending" || edge.addresseeId !== me)
      throw new Error("No incoming request from this user");
    await assertFriendCapacity(ctx, me, requesterId);
    const respondedAt = Date.now();
    await ctx.db.patch(edge._id, {
      status: "accepted",
      respondedAt,
    });
    await ensureFriendEdges(ctx, edge._id, me, requesterId, respondedAt);
    await adjustFriendCounts(ctx, me, requesterId, 1);
    await deleteNotificationsBetween(ctx, me, requesterId, ["friend_request"]);
    await notify(ctx, {
      userId: requesterId,
      actorId: me,
      kind: "friend_accept",
    });
  },
});

// Decline an incoming request, cancel an outgoing one, or unfriend — all
// collapse to deleting the pair's edge, each with its own precondition.
export const decline = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    const edge = await friendshipForPair(ctx, me, userId);
    if (!edge || edge.status !== "pending" || edge.addresseeId !== me)
      throw new Error("No incoming request from this user");
    await deleteNotificationsBetween(ctx, me, userId, ["friend_request"]);
    await ctx.db.delete(edge._id);
  },
});

export const cancelRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    const edge = await friendshipForPair(ctx, me, userId);
    if (!edge || edge.status !== "pending" || edge.requesterId !== me)
      throw new Error("No outgoing request to this user");
    await deleteNotificationsBetween(ctx, userId, me, ["friend_request"]);
    await ctx.db.delete(edge._id);
  },
});

export const unfriend = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    const edge = await friendshipForPair(ctx, me, userId);
    if (!edge || edge.status !== "accepted")
      throw new Error("You are not friends with this user");
    await deleteFriendEdges(ctx, me, userId);
    await ctx.db.delete(edge._id);
    await adjustFriendCounts(ctx, me, userId, -1);
  },
});

async function visibleFriendCards(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  subjectId: Id<"users">,
  ids: Id<"users">[],
) {
  const cards = [];
  for (const id of ids) {
    if (subjectId !== viewerId && await isBlockedEitherWay(ctx, viewerId, id)) continue;
    const profile = await profileOf(ctx, id);
    if (!profile || profile.deletedAt) continue;
    cards.push({
      userId: id,
      displayName: profile.displayName,
      avatarHue: profile.avatarHue,
    });
  }
  return cards;
}

async function visibleFriendSubject(
  ctx: QueryCtx,
  requestedId?: Id<"users">,
): Promise<{ viewerId: Id<"users">; subjectId: Id<"users"> } | null> {
  const viewerId = await requireActiveUser(ctx).catch(() => null);
  if (!viewerId) return null;
  const subjectId = requestedId ?? viewerId;
  if (subjectId !== viewerId) {
    const profile = await requireActiveProfile(ctx, subjectId).catch(() => null);
    if (!profile || await isBlockedEitherWay(ctx, viewerId, subjectId)) return null;
    if (profile.friendsListPublic === false && !(await areFriends(ctx, viewerId, subjectId))) {
      return null;
    }
  }
  return { viewerId, subjectId };
}

export const list = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const subject = await visibleFriendSubject(ctx, userId);
    if (!subject) return [];
    const ids = await friendIdsOf(ctx, subject.subjectId, MAX_FRIEND_LIST_RESULTS);
    return await visibleFriendCards(ctx, subject.viewerId, subject.subjectId, ids);
  },
});

export const listPage = query({
  args: {
    userId: v.optional(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { userId, paginationOpts }) => {
    const subject = await visibleFriendSubject(ctx, userId);
    if (!subject) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("friendEdges")
      .withIndex("by_user_created", (q) => q.eq("userId", subject.subjectId))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return {
      ...result,
      page: await visibleFriendCards(
        ctx,
        subject.viewerId,
        subject.subjectId,
        result.page.map((edge) => edge.friendId),
      ),
    };
  },
});

export const count = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const subject = await visibleFriendSubject(ctx, userId);
    if (!subject) return null;
    if (subject.subjectId !== subject.viewerId) return null;
    const stats = await userStats(ctx, subject.subjectId);
    return stats?.friendCountExact ? stats.friendCount ?? 0 : null;
  },
});

export const requests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { incoming: [], outgoing: [] };
    const incomingEdges = await ctx.db
      .query("friendships")
      .withIndex("by_addressee_status", (q) =>
        q.eq("addresseeId", me).eq("status", "pending"),
      )
      .take(MAX_PENDING_FRIEND_REQUESTS);
    const outgoingEdges = await ctx.db
      .query("friendships")
      .withIndex("by_requester_status", (q) =>
        q.eq("requesterId", me).eq("status", "pending"),
      )
      .take(MAX_PENDING_FRIEND_REQUESTS);
    return {
      incoming: await Promise.all(
        incomingEdges.map((e) => authorCard(ctx, e.requesterId)),
      ),
      outgoing: await Promise.all(
        outgoingEdges.map((e) => authorCard(ctx, e.addresseeId)),
      ),
    };
  },
});

// People You May Know: friends-of-friends first (ranked by mutual count),
// padded with recently joined profiles. Excludes self, friends, and pairs
// with a pending request in either direction.
export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const myFriends = await friendIdsOf(ctx, me, MAX_SUGGESTION_SEED_FRIENDS);
    const excluded = new Set<Id<"users">>([me, ...myFriends]);
    for (const dir of ["by_requester_status", "by_addressee_status"] as const) {
      const pending = await ctx.db
        .query("friendships")
        .withIndex(dir, (q) =>
          dir === "by_requester_status"
            ? q.eq("requesterId", me).eq("status", "pending")
            : q.eq("addresseeId", me).eq("status", "pending"),
        )
        .take(MAX_PENDING_FRIEND_REQUESTS);
      for (const e of pending) {
        excluded.add(e.requesterId === me ? e.addresseeId : e.requesterId);
      }
    }

    const mutualCounts = new Map<Id<"users">, number>();
    for (const friendId of myFriends.slice(0, MAX_SUGGESTION_SEED_FRIENDS)) {
      for (const fof of await friendIdsOf(
        ctx,
        friendId,
        MAX_SUGGESTION_FRIENDS_PER_SEED,
      )) {
        if (excluded.has(fof)) continue;
        mutualCounts.set(fof, (mutualCounts.get(fof) ?? 0) + 1);
      }
    }
    const ranked = [...mutualCounts.entries()].sort((a, b) => b[1] - a[1]);

    const picks: { userId: Id<"users">; mutualCount: number }[] = [];
    for (const [userId, mutualCount] of ranked) {
      if (picks.length >= 8) break;
      if (await isBlockedEitherWay(ctx, me, userId)) continue;
      if (await areFriends(ctx, me, userId)) continue;
      picks.push({ userId, mutualCount });
    }

    if (picks.length < 8) {
      const recent = await ctx.db.query("profiles").order("desc").take(24);
      for (const p of recent) {
        if (picks.length >= 8) break;
        if (p.deletedAt) continue;
        if (excluded.has(p.userId)) continue;
        if (picks.some((x) => x.userId === p.userId)) continue;
        if (await isBlockedEitherWay(ctx, me, p.userId)) continue;
        if (await areFriends(ctx, me, p.userId)) continue;
        picks.push({ userId: p.userId, mutualCount: 0 });
      }
    }

    return await Promise.all(
      picks.map(async (pick) => ({
        ...(await authorCard(ctx, pick.userId)),
        mutualCount: pick.mutualCount,
      })),
    );
  },
});
