import { configuredAuthMode, currentUserId } from "./authIdentity";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { signedMediaUrl } from "./mediaSign";
import { pushIsEnabled } from "./runtime";
import { adjustUserStat } from "./stats";
import { enqueueDelivery } from "./delivery";
import {
  MAX_FRIENDS,
  MAX_GROUPS_PER_USER,
  MAX_PAIR_ROWS,
  NOTIFICATION_WRITE_BATCH,
} from "./limits";

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
    .take(MAX_PAIR_ROWS);
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

export async function ensureFriendEdges(
  ctx: MutationCtx,
  friendshipId: Id<"friendships">,
  a: Id<"users">,
  b: Id<"users">,
  createdAt: number,
): Promise<void> {
  if (a === b) throw new Error("A friend edge must connect two users");
  for (const [userId, friendId] of [[a, b], [b, a]] as const) {
    const rows = await ctx.db
      .query("friendEdges")
      .withIndex("by_user_friend", (q) =>
        q.eq("userId", userId).eq("friendId", friendId),
      )
      .take(MAX_PAIR_ROWS + 1);
    if (rows.length > MAX_PAIR_ROWS) {
      throw new Error(`Friend edge duplicate limit exceeded (${MAX_PAIR_ROWS})`);
    }
    const keep = rows[0];
    if (keep) {
      if (keep.friendshipId !== friendshipId || keep.createdAt !== createdAt) {
        await ctx.db.patch(keep._id, { friendshipId, createdAt });
      }
      for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    } else {
      await ctx.db.insert("friendEdges", { userId, friendId, friendshipId, createdAt });
    }
  }
}

export async function deleteFriendEdges(
  ctx: MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<void> {
  for (const [userId, friendId] of [[a, b], [b, a]] as const) {
    const rows = await ctx.db
      .query("friendEdges")
      .withIndex("by_user_friend", (q) =>
        q.eq("userId", userId).eq("friendId", friendId),
      )
      .take(MAX_PAIR_ROWS + 1);
    if (rows.length > MAX_PAIR_ROWS) {
      throw new Error(`Friend edge duplicate limit exceeded (${MAX_PAIR_ROWS})`);
    }
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

// Accepted friend ids use one materialized adjacency index. The required
// production migration builds these rows before readiness can pass.
export async function friendIdsOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  limit: number,
): Promise<Id<"users">[]> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_FRIENDS));
  const rows = await ctx.db
    .query("friendEdges")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(boundedLimit);
  return rows.map((row) => row.friendId);
}

export async function occupyPair(
  ctx: MutationCtx,
  kind: string,
  key: string,
): Promise<void> {
  const [rawA, rawB] = key.split(":");
  if (!rawA || !rawB) throw new Error("Invalid pair key");
  const userA = rawA as Id<"users">;
  const userB = rawB as Id<"users">;
  const rows = await ctx.db
    .query("pairLocks")
    .withIndex("by_kind_key", (q) => q.eq("kind", kind).eq("pairKey", key))
    .take(MAX_PAIR_ROWS);
  const keep = rows[0];
  if (keep) {
    // Patch so a concurrent writer retries on this document (OCC).
    await ctx.db.patch(keep._id, { createdAt: keep.createdAt, userA, userB });
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    return;
  }
  await ctx.db.insert("pairLocks", { kind, pairKey: key, userA, userB, createdAt: Date.now() });
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
    .take(MAX_GROUPS_PER_USER);
  return rows.map((row) => row.groupId);
}

export async function requireActiveUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await currentUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const profile = await profileOf(ctx, userId);
  if (!profile) throw new Error("Create your profile first");
  if (profile.deletedAt) throw new Error("This account is closed");
  if (configuredAuthMode() === "convex-auth" && process.env.RESEND_API_KEY) {
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

export async function requireActiveProfile(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"profiles">> {
  const profile = await profileOf(ctx, userId);
  if (!profile || profile.deletedAt) throw new Error("User not found");
  return profile;
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

export async function isBlockedEitherWay(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  if (a === b) return false;
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(a, b)))
    .take(MAX_PAIR_ROWS);
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
    .take(NOTIFICATION_WRITE_BATCH);
  let unreadDeleted = 0;
  for (const row of rows) {
    if (kinds && !kinds.includes(row.kind)) continue;
    if (!row.read) unreadDeleted += 1;
    await ctx.db.delete(row._id);
  }
  if (unreadDeleted > 0) {
    await adjustUserStat(ctx, recipientId, "notificationUnreadCount", -unreadDeleted);
  }
  if (rows.length === NOTIFICATION_WRITE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.notifications.deleteBetweenBatch, {
      recipientId,
      actorId,
      kinds,
    });
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
  if (post.deletedAt) return false;
  if (post.authorId === viewerId) return true;
  if (blockedIds?.has(post.authorId)) return false;
  if (post.groupId && !memberGroupIds?.has(post.groupId)) return false;
  if (mutedIds?.has(post.authorId)) return false;
  if (post.groupId) return true;
  if (post.audience === "public") return true;
  return viewerFriendIds.has(post.authorId);
}

// Indexed point lookups scale with the page size, not with the viewer's full
// friend, block, mute, or group graph. It also makes an account tombstone hide
// every post immediately while physical cleanup continues in the background.
export function postVisibilityEvaluator(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<"users">,
  respectMute = true,
): (post: Doc<"posts">) => Promise<boolean> {
  const activeAuthors = new Map<Id<"users">, Promise<boolean>>();
  const blockedAuthors = new Map<Id<"users">, Promise<boolean>>();
  const mutedAuthors = new Map<Id<"users">, Promise<boolean>>();
  const friendAuthors = new Map<Id<"users">, Promise<boolean>>();
  const memberGroups = new Map<Id<"groups">, Promise<boolean>>();

  return async (post) => {
    if (post.deletedAt) return false;
    if (post.authorId === viewerId) return true;
    let active = activeAuthors.get(post.authorId);
    if (!active) {
      active = profileOf(ctx, post.authorId).then(
        (profile) => profile !== null && !profile.deletedAt,
      );
      activeAuthors.set(post.authorId, active);
    }
    if (!(await active)) return false;
    let blocked = blockedAuthors.get(post.authorId);
    if (!blocked) {
      blocked = isBlockedEitherWay(ctx, viewerId, post.authorId);
      blockedAuthors.set(post.authorId, blocked);
    }
    if (await blocked) return false;
    if (post.groupId) {
      let member = memberGroups.get(post.groupId);
      if (!member) {
        member = ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", post.groupId!).eq("userId", viewerId),
          )
          .unique()
          .then((membership) => membership !== null);
        memberGroups.set(post.groupId, member);
      }
      return await member;
    }
    if (respectMute) {
      let muted = mutedAuthors.get(post.authorId);
      if (!muted) {
        muted = ctx.db
          .query("mutes")
          .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(viewerId, post.authorId)))
          .take(MAX_PAIR_ROWS)
          .then((rows) =>
            rows.some(
              (row) => row.muterId === viewerId && row.mutedId === post.authorId,
            ),
          );
        mutedAuthors.set(post.authorId, muted);
      }
      if (await muted) return false;
    }
    if (post.audience === "public") return true;
    let friend = friendAuthors.get(post.authorId);
    if (!friend) {
      friend = areFriends(ctx, viewerId, post.authorId);
      friendAuthors.set(post.authorId, friend);
    }
    return await friend;
  };
}

export async function postVisibleToViewer(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  viewerId: Id<"users">,
  respectMute = true,
): Promise<boolean> {
  return await postVisibilityEvaluator(ctx, viewerId, respectMute)(post);
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
  if (!(await postVisibleToViewer(ctx, post, viewerId, false))) return null;
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

export async function reparentConversationBatch(
  ctx: MutationCtx,
  extra: Doc<"conversations">,
  keep: Doc<"conversations">,
): Promise<void> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", extra._id))
    .take(100);
  for (const message of messages) {
    await ctx.db.patch(message._id, { conversationId: keep._id });
  }
  if (messages.length === 100) {
    await ctx.scheduler.runAfter(0, internal.messages.mergeConversationBatch, {
      extraId: extra._id,
      keepId: keep._id,
    });
    return;
  }
  const extraMembers = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) => q.eq("conversationId", extra._id))
    .take(MAX_PAIR_ROWS);
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
      .take(MAX_PAIR_ROWS);
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
    .take(MAX_PAIR_ROWS);
  const keep = pickConversation(rows);
  if (!keep) return null;
  for (const extra of rows) {
    if (extra._id !== keep._id) await reparentConversationBatch(ctx, extra, keep);
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

async function resolvedMediaUrl(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<string | null> {
  return (await signedMediaUrl(storageId)) ?? await ctx.storage.getUrl(storageId);
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
  const [author, mine, saved, imageUrls, videoUrl, previewImageUrl] = await Promise.all([
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
    Promise.all(uniqueIds.map((id) => resolvedMediaUrl(ctx, id))).then((urls) =>
      urls.filter((url): url is string => !!url)),
    post.videoId ? resolvedMediaUrl(ctx, post.videoId) : Promise.resolve(null),
    post.linkPreview?.imageId
      ? resolvedMediaUrl(ctx, post.linkPreview.imageId)
      : Promise.resolve(null),
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
    linkPreview: post.linkPreview
      ? {
          url: post.linkPreview.url,
          title: post.linkPreview.title,
          description: post.linkPreview.description,
          imageUrl: previewImageUrl ?? undefined,
        }
      : null,
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
  const recipient = await profileOf(ctx, args.userId);
  if (!recipient || recipient.deletedAt) return;
  const notificationId = await ctx.db.insert("notifications", {
    userId: args.userId,
    actorId: args.actorId,
    kind: args.kind,
    postId: args.postId,
    read: false,
    createdAt: Date.now(),
  });
  await adjustUserStat(ctx, args.userId, "notificationUnreadCount", 1);
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
      await enqueueDelivery(ctx, `notification:${notificationId}:email`, {
        kind: "email",
        to: email,
        subject: "Openbook",
        text: `${text}${origin ? ` ${origin}${path}` : ""}`,
      }, args.userId);
    }
  }
  if (pushIsEnabled()) {
    await enqueueDelivery(ctx, `notification:${notificationId}:push`, {
      kind: "push",
      userId: args.userId,
      title: "Openbook",
      body: text,
      url: path,
    }, args.userId);
  }
}

// Deterministic display hue from a user id — stable avatars with no uploads.
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
