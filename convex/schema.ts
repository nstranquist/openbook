import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const planValidator = v.union(v.literal("free"), v.literal("pro"));

// Stripe subscription lifecycle states we mirror. Only active/trialing entitle
// the user to the paid plan; anything else falls back to free.
export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("trialing"),
  v.literal("past_due"),
  v.literal("canceled"),
);

// Six social reactions. Stored one row per (post, user); the
// denormalized tally lives on the post itself (posts.reactionCounts).
export const reactionKindValidator = v.union(
  v.literal("like"),
  v.literal("love"),
  v.literal("haha"),
  v.literal("wow"),
  v.literal("sad"),
  v.literal("angry"),
);

export const reactionCountsValidator = v.object({
  like: v.number(),
  love: v.number(),
  haha: v.number(),
  wow: v.number(),
  sad: v.number(),
  angry: v.number(),
});

export const audienceValidator = v.union(
  v.literal("public"),
  v.literal("friends"),
);

// One schema, one source of truth. Every surface reads/writes these tables
// through reactive Convex queries — the sync layer is the database itself.
export default defineSchema({
  // Auth identity tables (users, sessions, accounts, ...). Convex Auth.
  ...authTables,

  // Public-facing identity. One row per user, created on first session
  // (profiles.ensure). Avatars/covers are deterministic hues. Post photos
  // use Convex file storage (posts.imageId).
  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    work: v.optional(v.string()),
    location: v.optional(v.string()),
    avatarHue: v.number(), // 0-360, derived once at creation
    coverHue: v.number(),
    joinedAt: v.number(),
    deletedAt: v.optional(v.number()),
    bioAudience: v.optional(audienceValidator),
    friendsListPublic: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .searchIndex("search_name", { searchField: "displayName" }),

  // Timeline posts. Reaction/comment tallies are denormalized here and kept
  // exact inside the same mutation transaction that writes the child row.
  posts: defineTable({
    authorId: v.id("users"),
    body: v.string(),
    audience: audienceValidator,
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    imageId: v.optional(v.id("_storage")),
    imageIds: v.optional(v.array(v.id("_storage"))),
    videoId: v.optional(v.id("_storage")),
    groupId: v.optional(v.id("groups")),
    commentCount: v.number(),
    reactionCounts: reactionCountsValidator,
  })
    .index("by_author", ["authorId"])
    .index("by_created", ["createdAt"])
    .index("by_group", ["groupId", "createdAt"])
    .searchIndex("search_body", { searchField: "body", filterFields: ["audience"] }),

  comments: defineTable({
    postId: v.id("posts"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_author", ["authorId"]),

  // One row per (post, user); changing your reaction rewrites the row.
  reactions: defineTable({
    postId: v.id("posts"),
    userId: v.id("users"),
    kind: reactionKindValidator,
  })
    .index("by_post", ["postId"])
    .index("by_post_user", ["postId", "userId"])
    .index("by_user", ["userId"]),

  // Friend graph. One row per pair for the whole lifecycle:
  // pending (requester → addressee) then accepted. Declining deletes the row.
  // pairKey = sorted ids joined ":" — the uniqueness handle for the pair.
  friendships: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    pairKey: v.string(),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_pair", ["pairKey"])
    .index("by_requester_status", ["requesterId", "status"])
    .index("by_addressee_status", ["addresseeId", "status"]),

  notifications: defineTable({
    userId: v.id("users"), // recipient
    actorId: v.id("users"),
    kind: v.union(
      v.literal("friend_request"),
      v.literal("friend_accept"),
      v.literal("reaction"),
      v.literal("comment"),
    ),
    postId: v.optional(v.id("posts")),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "read"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_actor", ["userId", "actorId"])
    .index("by_actor", ["actorId"]),

  // Direct messages. One conversation per user pair (pairKey, like friendships);
  // unread tallies are denormalized per member and reset by markRead.
  conversations: defineTable({
    pairKey: v.string(),
    participantIds: v.array(v.id("users")),
    lastMessageAt: v.number(),
    lastMessageBody: v.string(),
    lastSenderId: v.optional(v.id("users")),
  }).index("by_pair", ["pairKey"]),

  conversationMembers: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastActivityAt: v.number(), // mirror of conversation.lastMessageAt for sorting
    unreadCount: v.number(),
    lastReadAt: v.optional(v.number()),
    hiddenAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "lastActivityAt"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .searchIndex("search_body", { searchField: "body" }),

  // Billing mirror, keyed by user, kept in sync by the Stripe webhook (billing.ts).
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: planValidator,
    status: subscriptionStatusValidator,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  blocks: defineTable({
    blockerId: v.id("users"),
    blockedId: v.id("users"),
    pairKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_pair", ["pairKey"])
    .index("by_blocker", ["blockerId"])
    .index("by_blocked", ["blockedId"]),

  rateLimits: defineTable({
    userId: v.id("users"),
    action: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_user_action", ["userId", "action"]),

  uploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    used: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"])
    .index("by_used_created", ["used", "createdAt"]),

  pairLocks: defineTable({
    kind: v.string(),
    pairKey: v.string(),
    createdAt: v.number(),
  }).index("by_kind_key", ["kind", "pairKey"]),

  mutes: defineTable({
    muterId: v.id("users"),
    mutedId: v.id("users"),
    pairKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_pair", ["pairKey"])
    .index("by_muter", ["muterId"]),

  reports: defineTable({
    reporterId: v.id("users"),
    targetUserId: v.optional(v.id("users")),
    postId: v.optional(v.id("posts")),
    reason: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  })
    .index("by_reporter", ["reporterId"])
    .index("by_status", ["status", "createdAt"]),

  stories: defineTable({
    authorId: v.id("users"),
    body: v.string(),
    imageId: v.optional(v.id("_storage")),
    audience: audienceValidator,
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_author", ["authorId"])
    .index("by_expires", ["expiresAt"]),

  groups: defineTable({
    name: v.string(),
    description: v.string(),
    kind: v.union(v.literal("group"), v.literal("page")),
    creatorId: v.id("users"),
    createdAt: v.number(),
  }).index("by_creator", ["creatorId"]),

  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_user", ["groupId", "userId"]),

  events: defineTable({
    title: v.string(),
    description: v.string(),
    startAt: v.number(),
    hostId: v.id("users"),
    groupId: v.optional(v.id("groups")),
    createdAt: v.number(),
  })
    .index("by_start", ["startAt"])
    .index("by_host", ["hostId"]),

  eventRsvps: defineTable({
    eventId: v.id("events"),
    userId: v.id("users"),
    status: v.union(v.literal("going"), v.literal("interested")),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_user", ["userId"])
    .index("by_event_user", ["eventId", "userId"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
});
