import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  authorCard,
  blockedPairIds,
  collapseDuplicatePairRows,
  deleteNotificationsBetween,
  friendIdsOf,
  friendshipForPair,
  isBlockedEitherWay,
  notify,
  pairKey,
} from "./lib/social";
import { takeRate } from "./lib/rate";

// Friend-graph lifecycle. One friendships row per pair: pending → accepted,
// or deleted (decline/cancel/unfriend). Every transition fans out the right
// notification and nothing else.

export const sendRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId: addresseeId }) => {
    const requesterId = await getAuthUserId(ctx);
    if (!requesterId) throw new Error("Not authenticated");
    if (requesterId === addresseeId)
      throw new Error("You cannot friend yourself");
    const addressee = await ctx.db.get(addresseeId);
    if (!addressee) throw new Error("User not found");
    if (await isBlockedEitherWay(ctx, requesterId, addresseeId))
      throw new Error("You cannot send a friend request to this user");
    await takeRate(ctx, requesterId, "friend_request");
    const existing = await friendshipForPair(ctx, requesterId, addresseeId);
    if (existing?.status === "accepted")
      throw new Error("Already friends");
    if (existing?.status === "pending") {
      // The other side already asked — treat a cross-request as an accept.
      if (existing.addresseeId === requesterId) {
        await ctx.db.patch(existing._id, {
          status: "accepted",
          respondedAt: Date.now(),
        });
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
    const key = pairKey(requesterId, addresseeId);
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
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const edge = await friendshipForPair(ctx, me, requesterId);
    if (!edge || edge.status !== "pending" || edge.addresseeId !== me)
      throw new Error("No incoming request from this user");
    await ctx.db.patch(edge._id, {
      status: "accepted",
      respondedAt: Date.now(),
    });
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
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
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
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
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
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const edge = await friendshipForPair(ctx, me, userId);
    if (!edge || edge.status !== "accepted")
      throw new Error("You are not friends with this user");
    await ctx.db.delete(edge._id);
  },
});

export const list = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    const subject = userId ?? me;
    const ids = await friendIdsOf(ctx, subject);
    return await Promise.all(ids.map((id) => authorCard(ctx, id)));
  },
});

export const requests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (!me) return { incoming: [], outgoing: [] };
    const incomingEdges = await ctx.db
      .query("friendships")
      .withIndex("by_addressee_status", (q) =>
        q.eq("addresseeId", me).eq("status", "pending"),
      )
      .collect();
    const outgoingEdges = await ctx.db
      .query("friendships")
      .withIndex("by_requester_status", (q) =>
        q.eq("requesterId", me).eq("status", "pending"),
      )
      .collect();
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
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    const myFriends = await friendIdsOf(ctx, me);
    const blocked = await blockedPairIds(ctx, me);
    const excluded = new Set<Id<"users">>([me, ...myFriends, ...blocked]);
    for (const dir of ["by_requester_status", "by_addressee_status"] as const) {
      const pending = await ctx.db
        .query("friendships")
        .withIndex(dir, (q) =>
          dir === "by_requester_status"
            ? q.eq("requesterId", me).eq("status", "pending")
            : q.eq("addresseeId", me).eq("status", "pending"),
        )
        .collect();
      for (const e of pending) {
        excluded.add(e.requesterId === me ? e.addresseeId : e.requesterId);
      }
    }

    const mutualCounts = new Map<Id<"users">, number>();
    for (const friendId of myFriends) {
      for (const fof of await friendIdsOf(ctx, friendId)) {
        if (excluded.has(fof)) continue;
        mutualCounts.set(fof, (mutualCounts.get(fof) ?? 0) + 1);
      }
    }
    const ranked = [...mutualCounts.entries()].sort((a, b) => b[1] - a[1]);

    const picks: { userId: Id<"users">; mutualCount: number }[] = ranked
      .slice(0, 8)
      .map(([userId, mutualCount]) => ({ userId, mutualCount }));

    if (picks.length < 8) {
      const recent = await ctx.db.query("profiles").order("desc").take(24);
      for (const p of recent) {
        if (picks.length >= 8) break;
        if (excluded.has(p.userId)) continue;
        if (picks.some((x) => x.userId === p.userId)) continue;
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
