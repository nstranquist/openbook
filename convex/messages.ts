import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  areFriends,
  authorCard,
  collapseDuplicatePairRows,
  isBlockedEitherWay,
  occupyPair,
  pairKey,
  profileOf,
  requireActiveUser,
  reparentConversationBatch,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import { pushIsEnabled } from "./lib/runtime";
import { internal } from "./_generated/api";
import { MAX_TYPING_ROWS, MAX_UNREAD_BADGE } from "./lib/limits";
import { adjustUserStat, userStats } from "./lib/stats";
import { enqueueDelivery } from "./lib/delivery";
import { boundedPaginationOptions } from "./lib/pagination";

export const MAX_MESSAGE_LENGTH = 4000;

async function requireActiveRecipient(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const profile = await profileOf(ctx, userId);
  if (!profile || profile.deletedAt) throw new Error("User not found");
}

// Direct messages. One conversation per user pair, found/created by pairKey,
// with per-member denormalized unread counts. Realtime delivery is just the
// reactive query re-running — no sockets to manage.

async function getOrCreateConversation(
  ctx: MutationCtx,
  me: Id<"users">,
  otherId: Id<"users">,
): Promise<Doc<"conversations">> {
  if (me === otherId) throw new Error("You cannot message yourself");
  await requireActiveRecipient(ctx, otherId);
  const key = pairKey(me, otherId);
  await occupyPair(ctx, "conversation", key);
  const existing = await collapseDuplicatePairRows(ctx, "conversations", key);
  if (existing) return existing as Doc<"conversations">;
  const now = Date.now();
  const conversationId = await ctx.db.insert("conversations", {
    pairKey: key,
    participantIds: [me, otherId],
    lastMessageAt: now,
    lastMessageBody: "",
  });
  for (const userId of [me, otherId]) {
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId,
      lastActivityAt: now,
      unreadCount: 0,
    });
  }
  const kept = await collapseDuplicatePairRows(ctx, "conversations", key);
  if (kept && kept._id !== conversationId) {
    return kept as Doc<"conversations">;
  }
  return (await ctx.db.get(conversationId))!;
}

async function memberRow(
  ctx: MutationCtx | QueryCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId),
    )
    .unique();
}

async function conversationCard(
  ctx: QueryCtx,
  me: Id<"users">,
  membership: Doc<"conversationMembers">,
) {
  const conversation = await ctx.db.get(membership.conversationId);
  if (!conversation) return null;
  const otherId = conversation.participantIds.find((participant) => participant !== me);
  if (!otherId || membership.hiddenAt || await isBlockedEitherWay(ctx, me, otherId)) return null;
  const otherProfile = await profileOf(ctx, otherId);
  if (!otherProfile || otherProfile.deletedAt) return null;
  return {
    conversationId: conversation._id,
    other: await authorCard(ctx, otherId),
    lastMessageAt: conversation.lastMessageAt,
    lastMessageBody: conversation.lastMessageBody,
    lastSenderIsMe: conversation.lastSenderId === me,
    unreadCount: membership.unreadCount,
  };
}

// Open (or create) the DM thread with another user; returns the conversation id.
export const open = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    if (me === userId) throw new Error("You cannot message yourself");
    await requireActiveRecipient(ctx, userId);
    const key = pairKey(me, userId);
    const existing = await collapseDuplicatePairRows(ctx, "conversations", key);
    if (await isBlockedEitherWay(ctx, me, userId)) {
      throw new Error("You cannot message this user");
    }
    if (existing) {
      const conversationId = existing._id as Id<"conversations">;
      const member = await memberRow(ctx, conversationId, me);
      if (member?.hiddenAt) {
        await ctx.db.patch(member._id, { hiddenAt: undefined });
      }
      return conversationId;
    }
    if (!(await areFriends(ctx, me, userId))) {
      throw new Error("You can only message friends");
    }
    const conversation = await getOrCreateConversation(ctx, me, userId);
    return conversation._id;
  },
});

export const send = mutation({
  args: { conversationId: v.id("conversations"), body: v.string() },
  handler: async (ctx, { conversationId, body }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Message cannot be empty");
    if (trimmed.length > MAX_MESSAGE_LENGTH)
      throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH})`);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participantIds.includes(me))
      throw new Error("Not a participant of this conversation");
    const otherId = conversation.participantIds.find((id) => id !== me);
    if (otherId) await requireActiveRecipient(ctx, otherId);
    if (otherId && (await isBlockedEitherWay(ctx, me, otherId))) {
      throw new Error("You cannot message this user");
    }
    await takeRate(ctx, me, "message");
    const now = Date.now();
    const id = await ctx.db.insert("messages", {
      conversationId,
      senderId: me,
      body: trimmed,
      createdAt: now,
    });
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      lastMessageBody: trimmed,
      lastSenderId: me,
    });
    for (const userId of conversation.participantIds) {
      const member = await memberRow(ctx, conversationId, userId);
      if (!member) continue;
      await ctx.db.patch(member._id, {
        lastActivityAt: now,
        unreadCount:
          userId === me ? member.unreadCount : member.unreadCount + 1,
        hiddenAt: userId === me ? member.hiddenAt : undefined,
      });
      if (userId !== me) {
        await adjustUserStat(ctx, userId, "messageUnreadCount", 1);
      }
    }
    if (otherId && pushIsEnabled()) {
      await enqueueDelivery(ctx, `message:${id}:push`, {
        kind: "push",
        userId: otherId,
        title: "Openbook",
        body: "New message",
        url: `/messages/${conversationId}`,
      }, otherId);
    }
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    const me = await requireActiveUser(ctx);
    const message = await ctx.db.get(id);
    if (!message || message.senderId !== me) throw new Error("Message not found");
    const conversationId = message.conversationId;
    const conversation = await ctx.db.get(conversationId);
    if (conversation) {
      const otherId = conversation.participantIds.find((id) => id !== me);
      if (otherId) {
        const otherMember = await memberRow(ctx, conversationId, otherId);
        if (
          otherMember &&
          otherMember.unreadCount > 0 &&
          message.senderId === me &&
          message.createdAt > (otherMember.lastReadAt ?? 0)
        ) {
          await ctx.db.patch(otherMember._id, {
            unreadCount: Math.max(0, otherMember.unreadCount - 1),
          });
          await adjustUserStat(ctx, otherId, "messageUnreadCount", -1);
        }
      }
    }
    await ctx.db.delete(id);
    const convAfter = await ctx.db.get(conversationId);
    if (!convAfter) return;
    const latest = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .first();
    await ctx.db.patch(conversationId, {
      lastMessageAt: latest?.createdAt ?? convAfter.lastMessageAt,
      lastMessageBody: latest?.body ?? "",
      lastSenderId: latest?.senderId,
    });
  },
});

// The Messenger sidebar: my conversations, most recent first, with the other
// participant's card and my unread tally.
export const myConversations = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .take(50);
    const rows = await Promise.all(memberships.map((membership) =>
      conversationCard(ctx, me, membership)));
    return rows.filter((r) => r !== null);
  },
});

export const myConversationsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    const page = await Promise.all(result.page.map((membership) =>
      conversationCard(ctx, me, membership)));
    return { ...result, page: page.filter((row) => row !== null) };
  },
});

export const conversationSummary = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return null;
    const membership = await memberRow(ctx, conversationId, me);
    return membership ? await conversationCard(ctx, me, membership) : null;
  },
});

export const list = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return { page: [], isDone: true, continueCursor: "" };
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participantIds.includes(me))
      return { page: [], isDone: true, continueCursor: "" };
    const otherId = conversation.participantIds.find((p) => p !== me);
    if (otherId && (await isBlockedEitherWay(ctx, me, otherId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    const otherMember = otherId
      ? await ctx.db
          .query("conversationMembers")
          .withIndex("by_conversation_user", (q) =>
            q.eq("conversationId", conversationId).eq("userId", otherId),
          )
          .unique()
      : null;
    const otherReadAt = otherMember?.lastReadAt ?? 0;
    return {
      ...page,
      page: page.page.map((m) => ({
        _id: m._id,
        body: m.body,
        createdAt: m.createdAt,
        editedAt: m.editedAt ?? null,
        isMine: m.senderId === me,
        seenByOther: m.senderId === me && otherReadAt >= m.createdAt,
      })),
    };
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx);
    const member = await memberRow(ctx, conversationId, me);
    if (member && member.unreadCount > 0) {
      await adjustUserStat(ctx, me, "messageUnreadCount", -member.unreadCount);
      await ctx.db.patch(member._id, { unreadCount: 0, lastReadAt: Date.now(), hiddenAt: undefined });
    } else if (member)
      await ctx.db.patch(member._id, { lastReadAt: Date.now() });
  },
});

export const edit = mutation({
  args: { id: v.id("messages"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    const me = await requireActiveUser(ctx);
    const message = await ctx.db.get(id);
    if (!message || message.senderId !== me) throw new Error("Message not found");
    const trimmed = body.trim();
    if (!trimmed) throw new Error("Message cannot be empty");
    if (trimmed.length > MAX_MESSAGE_LENGTH)
      throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH})`);
    await takeRate(ctx, me, "message");
    await ctx.db.patch(id, { body: trimmed, editedAt: Date.now() });
    const latest = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", message.conversationId))
      .order("desc")
      .first();
    if (latest?._id === id) {
      await ctx.db.patch(message.conversationId, { lastMessageBody: trimmed });
    }
  },
});

export const hide = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx);
    const member = await memberRow(ctx, conversationId, me);
    if (member) {
      if (member.unreadCount > 0) {
        await adjustUserStat(ctx, me, "messageUnreadCount", -member.unreadCount);
      }
      await ctx.db.patch(member._id, { hiddenAt: Date.now(), unreadCount: 0 });
    }
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const term = q.trim();
    if (!term) return [];
    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_body", (s) => s.search("body", term))
      .take(24);
    const out: Array<{
      _id: Id<"messages">;
      body: string;
      createdAt: number;
      conversationId: Id<"conversations">;
    }> = [];
    for (const message of hits) {
      const conversation = await ctx.db.get(message.conversationId);
      if (!conversation?.participantIds.includes(me)) continue;
      const otherId = conversation.participantIds.find((p) => p !== me);
      if (otherId && (await isBlockedEitherWay(ctx, me, otherId))) continue;
      out.push({
        _id: message._id,
        body: message.body,
        createdAt: message.createdAt,
        conversationId: conversation._id,
      });
      if (out.length >= 8) break;
    }
    return out;
  },
});

// Total unread across conversations — the Messenger badge in the top nav.
export const unreadTotal = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return 0;
    const stats = await userStats(ctx, me);
    if (stats?.messageUnreadCountExact) {
      return Math.min(stats.messageUnreadCount, MAX_UNREAD_BADGE);
    }
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .take(MAX_UNREAD_BADGE);
    return Math.min(
      memberships.reduce((total, member) => total + member.unreadCount, 0),
      MAX_UNREAD_BADGE,
    );
  },
});

const TYPING_TTL_MS = 6000;

export const touchTyping = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participantIds.includes(me))
      throw new Error("Not a participant of this conversation");
    await takeRate(ctx, me, "typing");
    const existing = await ctx.db
      .query("conversationTyping")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me),
      )
      .unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { updatedAt: now });
    else await ctx.db.insert("conversationTyping", { conversationId, userId: me, updatedAt: now });
  },
});

export const typing = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx).catch(() => null);
    if (!me) return [];
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participantIds.includes(me)) return [];
    const rows = await ctx.db
      .query("conversationTyping")
      .withIndex("by_conversation_user", (q) => q.eq("conversationId", conversationId))
      .take(MAX_TYPING_ROWS);
    const cutoff = Date.now() - TYPING_TTL_MS;
    return rows.filter((r) => r.userId !== me && r.updatedAt >= cutoff).map((r) => r.userId);
  },
});

export const mergeConversationBatch = internalMutation({
  args: {
    extraId: v.id("conversations"),
    keepId: v.id("conversations"),
  },
  handler: async (ctx, { extraId, keepId }) => {
    const [extra, keep] = await Promise.all([ctx.db.get(extraId), ctx.db.get(keepId)]);
    if (!extra || !keep || extra._id === keep._id) return;
    await reparentConversationBatch(ctx, extra, keep);
  },
});
