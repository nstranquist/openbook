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

export async function friendshipForPair(
  ctx: QueryCtx | MutationCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<Doc<"friendships"> | null> {
  return await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("pairKey", pairKey(a, b)))
    .unique();
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

// Visibility rule, in one place: public posts are visible to everyone;
// friends-audience posts to the author and their accepted friends.
export function postVisibleTo(
  post: Doc<"posts">,
  viewerId: Id<"users">,
  viewerFriendIds: Set<Id<"users">>,
): boolean {
  if (post.authorId === viewerId) return true;
  if (post.audience === "public") return true;
  return viewerFriendIds.has(post.authorId);
}

export interface EnrichedPost {
  _id: Id<"posts">;
  authorId: Id<"users">;
  body: string;
  audience: "public" | "friends";
  createdAt: number;
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
  const [author, mine] = await Promise.all([
    authorCard(ctx, post.authorId),
    ctx.db
      .query("reactions")
      .withIndex("by_post_user", (q) =>
        q.eq("postId", post._id).eq("userId", viewerId),
      )
      .unique(),
  ]);
  const counts = post.reactionCounts as Record<ReactionKind, number>;
  const reactionTotal = REACTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
  return {
    _id: post._id,
    authorId: post.authorId,
    body: post.body,
    audience: post.audience,
    createdAt: post.createdAt,
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
