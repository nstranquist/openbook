import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// Shared social-graph helpers. Every function module routes pair identity,
// friendship checks, post enrichment, and notification fan-out through here so
// the rules live exactly once.

export type ReactionKind = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export const REACTION_KINDS: ReactionKind[] = [
  "like",
  "love",
  "haha",
  "wow",
  "sad",
  "angry",
];

export function emptyReactionCounts(): Record<ReactionKind, number> {
  return { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };
}

// Canonical pair identity for friendships and conversations: order-independent.
export function pairKey(a: Id<"users">, b: Id<"users">): string {
  return [a, b].sort().join(":");
}

function pickFriendship(rows: Doc<"friendships">[]): Doc<"friendships"> | null {
  if (rows.length === 0) return null;
  const accepted = rows.filter((row) => row.status === "accepted");
  const pool = accepted.length > 0 ? accepted : rows;
  return [...pool].sort((a, b) => a._creationTime - b._creationTime)[0] ?? null;
}

export async function friendshipForPair(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<Doc<"friendships"> | null> {
  const rows = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(a, b)))
    .collect();
  const keep = pickFriendship(rows);
  if (!keep) return null;
  if (rows.length > 1 && "insert" in ctx.db) {
    for (const extra of rows) {
      if (extra._id !== keep._id) await ctx.db.delete(extra._id);
    }
  }
  return keep;
}

export async function areFriends(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  if (a === b) return false;
  const edge = await friendshipForPair(ctx, a, b);
  return edge?.status === "accepted";
}

// Accepted friend ids of a user (both directions of the edge).
export async function friendIdsOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"users">[]> {
  const sent = await ctx.db
    .query("friendships")
    .withIndex("by_requester_status", (q) =>
      q.eq("requesterId", userId).eq("status", "accepted"),
    )
    .collect();
  const received = await ctx.db
    .query("friendships")
    .withIndex("by_addressee_status", (q) =>
      q.eq("addresseeId", userId).eq("status", "accepted"),
    )
    .collect();
  return [
    ...sent.map((f) => f.addresseeId),
    ...received.map((f) => f.requesterId),
  ];
}

export async function profileOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// The author card embedded in enriched posts/comments/notifications.
export interface AuthorCard {
  userId: Id<"users">;
  displayName: string;
  avatarHue: number;
}

export async function authorCard(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<AuthorCard> {
  const profile = await profileOf(ctx, userId);
  return {
    userId,
    displayName: profile?.displayName ?? "Openbook user",
    avatarHue: profile?.avatarHue ?? 210,
  };
}

export async function blockedPairIds(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<"users">,
): Promise<Set<Id<"users">>> {
  const out = new Set<Id<"users">>();
  const asBlocker = await ctx.db
    .query("blocks")
    .withIndex("by_blocker", (q) => q.eq("blockerId", viewerId))
    .collect();
  const asBlocked = await ctx.db
    .query("blocks")
    .withIndex("by_blocked", (q) => q.eq("blockedId", viewerId))
    .collect();
  for (const row of asBlocker) out.add(row.blockedId);
  for (const row of asBlocked) out.add(row.blockerId);
  return out;
}

export async function isBlockedEitherWay(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  if (a === b) return false;
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(a, b)))
    .collect();
  return rows.length > 0;
}

export async function deleteNotificationsBetween(
  ctx: MutationCtx,
  recipientId: Id<"users">,
  actorId: Id<"users">,
  kinds?: Array<"friend_request" | "friend_accept" | "reaction" | "comment">,
): Promise<void> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_user_actor", (q) =>
      q.eq("userId", recipientId).eq("actorId", actorId),
    )
    .collect();
  for (const row of rows) {
    if (kinds && !kinds.includes(row.kind)) continue;
    await ctx.db.delete(row._id);
  }
}

// Visibility rule, in one place: public posts are visible to everyone;
// friends-audience posts to the author and their accepted friends.
// A block in either direction hides the author's posts from the viewer.
export function postVisibleTo(
  post: Doc<"posts">,
  viewerId: Id<"users">,
  viewerFriendIds: Set<Id<"users">>,
  blockedIds?: Set<Id<"users">>,
): boolean {
  if (post.authorId === viewerId) return true;
  if (blockedIds?.has(post.authorId)) return false;
  if (post.audience === "public") return true;
  return viewerFriendIds.has(post.authorId);
}

// Load a post only when the viewer may see it. Queries return null;
// mutations should throw "Post not found" so existence of hidden posts
// does not leak through a distinct error.
export async function loadVisiblePost(
  ctx: QueryCtx | MutationCtx,
  postId: Id<"posts">,
  viewerId: Id<"users">,
): Promise<Doc<"posts"> | null> {
  const post = await ctx.db.get(postId);
  if (!post) return null;
  const [friendIds, blockedIds] = await Promise.all([
    friendIdsOf(ctx, viewerId),
    blockedPairIds(ctx, viewerId),
  ]);
  if (!postVisibleTo(post, viewerId, new Set(friendIds), blockedIds)) return null;
  return post;
}

export async function requireVisiblePost(
  ctx: QueryCtx | MutationCtx,
  postId: Id<"posts">,
  viewerId: Id<"users">,
): Promise<Doc<"posts">> {
  const post = await loadVisiblePost(ctx, postId, viewerId);
  if (!post) throw new Error("Post not found");
  return post;
}

function pickConversation(rows: Doc<"conversations">[]): Doc<"conversations"> | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const aBody = a.lastMessageBody.trim() ? 1 : 0;
    const bBody = b.lastMessageBody.trim() ? 1 : 0;
    if (aBody !== bBody) return bBody - aBody;
    if (a.lastMessageAt !== b.lastMessageAt) return b.lastMessageAt - a.lastMessageAt;
    return b._creationTime - a._creationTime;
  })[0] ?? null;
}

async function reparentConversation(
  ctx: MutationCtx,
  extra: Doc<"conversations">,
  keep: Doc<"conversations">,
): Promise<void> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", extra._id))
    .collect();
  for (const message of messages) {
    await ctx.db.patch(message._id, { conversationId: keep._id });
  }
  const extraMembers = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) => q.eq("conversationId", extra._id))
    .collect();
  for (const extraMember of extraMembers) {
    const keepMember = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", keep._id).eq("userId", extraMember.userId),
      )
      .unique();
    if (keepMember) {
      await ctx.db.patch(keepMember._id, {
        unreadCount: keepMember.unreadCount + extraMember.unreadCount,
        lastActivityAt: Math.max(keepMember.lastActivityAt, extraMember.lastActivityAt),
      });
      await ctx.db.delete(extraMember._id);
    } else {
      await ctx.db.patch(extraMember._id, { conversationId: keep._id });
    }
  }
  if (extra.lastMessageAt >= keep.lastMessageAt) {
    await ctx.db.patch(keep._id, {
      lastMessageAt: extra.lastMessageAt,
      lastMessageBody: extra.lastMessageBody,
      lastSenderId: extra.lastSenderId,
    });
  }
  await ctx.db.delete(extra._id);
}

// pairKey is not unique. Concurrent inserts can land two rows. Mutations
// collapse to one document; queries pick without throwing.
export async function collapseDuplicatePairRows(
  ctx: MutationCtx,
  table: "friendships" | "conversations",
  key: string,
): Promise<Doc<"friendships"> | Doc<"conversations"> | null> {
  if (table === "friendships") {
    const rows = await ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("pairKey", key))
      .collect();
    const keep = pickFriendship(rows);
    if (!keep) return null;
    for (const extra of rows) {
      if (extra._id !== keep._id) await ctx.db.delete(extra._id);
    }
    return keep;
  }
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_pair", (q) => q.eq("pairKey", key))
    .collect();
  const keep = pickConversation(rows);
  if (!keep) return null;
  for (const extra of rows) {
    if (extra._id !== keep._id) await reparentConversation(ctx, extra, keep);
  }
  return (await ctx.db.get(keep._id)) ?? keep;
}

export interface EnrichedPost {
  _id: Id<"posts">;
  authorId: Id<"users">;
  body: string;
  audience: "public" | "friends";
  createdAt: number;
  editedAt: number | null;
  imageUrl: string | null;
  commentCount: number;
  reactionCounts: Record<ReactionKind, number>;
  reactionTotal: number;
  author: AuthorCard;
  myReaction: ReactionKind | null;
}

export async function enrichPost(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  viewerId: Id<"users">,
): Promise<EnrichedPost> {
  const [author, mine, imageUrl] = await Promise.all([
    authorCard(ctx, post.authorId),
    ctx.db
      .query("reactions")
      .withIndex("by_post_user", (q) =>
        q.eq("postId", post._id).eq("userId", viewerId),
      )
      .unique(),
    post.imageId ? ctx.storage.getUrl(post.imageId) : Promise.resolve(null),
  ]);
  const counts = post.reactionCounts as Record<ReactionKind, number>;
  const reactionTotal = REACTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
  return {
    _id: post._id,
    authorId: post.authorId,
    body: post.body,
    audience: post.audience,
    createdAt: post.createdAt,
    editedAt: post.editedAt ?? null,
    imageUrl,
    commentCount: post.commentCount,
    reactionCounts: counts,
    reactionTotal,
    author,
    myReaction: mine?.kind ?? null,
  };
}

// Notification fan-out. Never notifies the actor about their own action.
export async function notify(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    actorId: Id<"users">;
    kind: "friend_request" | "friend_accept" | "reaction" | "comment";
    postId?: Id<"posts">;
  },
): Promise<void> {
  if (args.userId === args.actorId) return;
  await ctx.db.insert("notifications", {
    userId: args.userId,
    actorId: args.actorId,
    kind: args.kind,
    postId: args.postId,
    read: false,
    createdAt: Date.now(),
  });
}

// Deterministic display hue from a user id — stable avatars with no uploads.
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
