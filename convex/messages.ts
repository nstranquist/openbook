import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  areFriends,
  authorCard,
  blockedPairIds,
  collapseDuplicatePairRows,
  isBlockedEitherWay,
  occupyPair,
  pairKey,
  requireActiveUser,
} from "./lib/social";
import { takeRate } from "./lib/rate";
import { internal } from "./_generated/api";

export const MAX_MESSAGE_LENGTH = 4000;

// Direct messages. One conversation per user pair, found/created by pairKey,
// with per-member denormalized unread counts. Realtime delivery is just the
// reactive query re-running — no sockets to manage.

async function getOrCreateConversation(
  ctx: MutationCtx,
  me: Id<"users">,
  otherId: Id<"users">,
): Promise<Doc<"conversations">> {
  if (me === otherId) throw new Error("You cannot message yourself");
  const other = await ctx.db.get(otherId);
  if (!other) throw new Error("User not found");
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
  ctx: MutationCtx,
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

// Open (or create) the DM thread with another user; returns the conversation id.
export const open = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    if (me === userId) throw new Error("You cannot message yourself");
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
    }
    if (
      otherId &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
    ) {
      await ctx.scheduler.runAfter(0, internal.pushSend.sendToUser, {
        userId: otherId,
        title: "Openbook",
        body: "New message",
        url: `/messages/${conversationId}`,
      });
    }
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const message = await ctx.db.get(id);
    if (!message || message.senderId !== me) throw new Error("Message not found");
    const conversationId = message.conversationId;
    const conversation = await ctx.db.get(conversationId);
    if (conversation) {
      const otherId = conversation.participantIds.find((id) => id !== me);
      if (otherId) {
        const otherMember = await memberRow(ctx, conversationId, otherId);
        if (otherMember && otherMember.unreadCount > 0 && message.senderId === me) {
          await ctx.db.patch(otherMember._id, {
            unreadCount: Math.max(0, otherMember.unreadCount - 1),
          });
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
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    const blocked = await blockedPairIds(ctx, me);
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .take(50);
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const conversation = await ctx.db.get(m.conversationId);
        if (!conversation) return null;
        const otherId = conversation.participantIds.find((p) => p !== me);
        if (!otherId || blocked.has(otherId) || m.hiddenAt) return null;
        return {
          conversationId: conversation._id,
          other: await authorCard(ctx, otherId),
          lastMessageAt: conversation.lastMessageAt,
          lastMessageBody: conversation.lastMessageBody,
          lastSenderIsMe: conversation.lastSenderId === me,
          unreadCount: m.unreadCount,
        };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

export const list = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const me = await getAuthUserId(ctx);
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
      .paginate(paginationOpts);
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
    const me = await getAuthUserId(ctx);
    if (!me) throw new Error("Not authenticated");
    const member = await memberRow(ctx, conversationId, me);
    if (member && member.unreadCount > 0)
      await ctx.db.patch(member._id, { unreadCount: 0, lastReadAt: Date.now(), hiddenAt: undefined });
    else if (member)
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
    await ctx.db.patch(id, { body: trimmed, editedAt: Date.now() });
  },
});

export const hide = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireActiveUser(ctx);
    const member = await memberRow(ctx, conversationId, me);
    if (member) await ctx.db.patch(member._id, { hiddenAt: Date.now() });
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    const term = q.trim();
    if (!term) return [];
    const blocked = await blockedPairIds(ctx, me);
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
      if (otherId && blocked.has(otherId)) continue;
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
    const me = await getAuthUserId(ctx);
    if (!me) return 0;
    const blocked = await blockedPairIds(ctx, me);
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect();
    let total = 0;
    for (const m of memberships) {
      const conversation = await ctx.db.get(m.conversationId);
      const otherId = conversation?.participantIds.find((p) => p !== me);
      if (!otherId || blocked.has(otherId) || m.hiddenAt) continue;
      total += m.unreadCount;
    }
    return total;
  },
});
