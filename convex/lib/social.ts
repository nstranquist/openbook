import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { signedMediaUrl } from "./mediaSign";

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

export async function occupyPair(
  ctx: MutationCtx,
  kind: string,
  key: string,
): Promise<void> {
  const rows = await ctx.db
    .query("pairLocks")
    .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("pairKey", key))
    .collect();
  const keep = rows[0];
  if (keep) {
    // Patch so a concurrent writer retries on this document (OCC).
    await ctx.db.patch(keep._id, { createdAt: keep.createdAt });
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    return;
  }
  await ctx.db.insert("pairLocks", { kind, pairKey: key, createdAt: Date.now() });
}

export function isOperator(userId: Id<"users">): boolean {
  const raw = process.env.OPERATOR_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

export async function groupIdsOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"groups">[]> {
  const rows = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.map((row) => row.groupId);
}

export async function mutedPairIds(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<"users">,
): Promise<Set<Id<"users">>> {
  const rows = await ctx.db
    .query("mutes")
    .withIndex("by_muter", (q) => q.eq("muterId", viewerId))
    .collect();
  return new Set(rows.map((row) => row.mutedId));
}

export async function requireActiveUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const profile = await profileOf(ctx, userId);
  if (profile?.deletedAt) throw new Error("This account is closed");
  if (process.env.RESEND_API_KEY) {
    const user = await ctx.db.get(userId);
    if (user && !user.emailVerificationTime) {
      throw new Error("Verify your email first");
    }
  }
  return userId;
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
  mutedIds?: Set<Id<"users">>,
  memberGroupIds?: Set<Id<"groups">>,
): boolean {
  if (post.authorId === viewerId) return true;
  if (blockedIds?.has(post.authorId)) return false;
  if (post.groupId && !memberGroupIds?.has(post.groupId)) return false;
  if (mutedIds?.has(post.authorId)) return false;
  if (post.groupId) return true;
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
  const [friendIds, blockedIds, groupIds] = await Promise.all([
    friendIdsOf(ctx, viewerId),
    blockedPairIds(ctx, viewerId),
    groupIdsOf(ctx, viewerId),
  ]);
  if (
    !postVisibleTo(
      post,
      viewerId,
      new Set(friendIds),
      blockedIds,
      undefined,
      new Set(groupIds),
    )
  )
    return null;
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
  imageUrls: string[];
  videoUrl: string | null;
  groupId: Id<"groups"> | null;
  commentCount: number;
  reactionCounts: Record<ReactionKind, number>;
  reactionTotal: number;
  author: AuthorCard;
  myReaction: ReactionKind | null;
  isSaved: boolean;
  linkPreview: {
    url: string;
    title?: string;
    description?: string;
    imageUrl?: string;
  } | null;
}

export async function enrichPost(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  viewerId: Id<"users">,
): Promise<EnrichedPost> {
  const ids = [
    ...(post.imageIds ?? []),
    ...(post.imageId && !(post.imageIds ?? []).includes(post.imageId)
      ? [post.imageId]
      : []),
  ];
  const uniqueIds = [...new Set(ids)];
  const [author, mine, saved, signed, fallback, videoUrl] = await Promise.all([
    authorCard(ctx, post.authorId),
    ctx.db
      .query("reactions")
      .withIndex("by_post_user", (q) =>
        q.eq("postId", post._id).eq("userId", viewerId),
      )
      .unique(),
    ctx.db
      .query("savedPosts")
      .withIndex("by_user_post", (q) =>
        q.eq("userId", viewerId).eq("postId", post._id),
      )
      .first(),
    Promise.all(uniqueIds.map((id) => signedMediaUrl(id))),
    Promise.all(uniqueIds.map((id) => ctx.storage.getUrl(id))),
    post.videoId ? ctx.storage.getUrl(post.videoId) : Promise.resolve(null),
  ]);
  const imageUrls = uniqueIds
    .map((_, i) => signed[i] ?? fallback[i])
    .filter((u): u is string => !!u);
  const counts = post.reactionCounts as Record<ReactionKind, number>;
  const reactionTotal = REACTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
  return {
    _id: post._id,
    authorId: post.authorId,
    body: post.body,
    audience: post.audience,
    createdAt: post.createdAt,
    editedAt: post.editedAt ?? null,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    videoUrl,
    groupId: post.groupId ?? null,
    commentCount: post.commentCount,
    reactionCounts: counts,
    reactionTotal,
    author,
    myReaction: mine?.kind ?? null,
    isSaved: saved !== null,
    linkPreview: post.linkPreview ?? null,
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
  const actor = await authorCard(ctx, args.actorId);
  const labels: Record<typeof args.kind, string> = {
    friend_request: "sent you a friend request",
    friend_accept: "accepted your friend request",
    reaction: "reacted to your post",
    comment: "commented on your post",
  };
  const text = `${actor.displayName} ${labels[args.kind]}.`;
  const origin = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  const path =
    args.kind === "friend_request" || args.kind === "friend_accept"
      ? "/friends"
      : args.postId
        ? `/post/${args.postId}`
        : "/";
  if (process.env.RESEND_API_KEY) {
    const user = await ctx.db.get(args.userId);
    const email = (user as { email?: string } | null)?.email;
    if (email) {
      await ctx.scheduler.runAfter(0, internal.emails.sendEmail, {
        to: email,
        subject: "Openbook",
        text: `${text}${origin ? ` ${origin}${path}` : ""}`,
      });
    }
  }
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    await ctx.scheduler.runAfter(0, internal.pushSend.sendToUser, {
      userId: args.userId,
      title: "Openbook",
      body: text,
      url: path,
    });
  }
}

// Deterministic display hue from a user id — stable avatars with no uploads.
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
