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
  // Convex Auth does not provide a session index for PKCE verifiers. Add the
  // same table with one extra index so account erasure stays bounded.
  authVerifiers: defineTable({
    sessionId: v.optional(v.id("authSessions")),
    signature: v.optional(v.string()),
  })
    .index("signature", ["signature"])
    .index("sessionId", ["sessionId"]),

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
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .searchIndex("search_name", { searchField: "displayName" }),

  // Stable production OIDC identities map to the same internal user IDs used
  // by the social graph. Local development continues to use Convex Auth.
  externalIdentities: defineTable({
    provider: v.literal("clerk"),
    tokenIdentifier: v.string(),
    providerUserId: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_provider_user", ["provider", "providerUserId"])
    .index("by_user", ["userId"]),

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
    linkPreview: v.optional(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        imageId: v.optional(v.id("_storage")),
        // Kept for backward-compatible reads. New previews proxy images into
        // Convex storage and never return this third-party URL to a client.
        imageUrl: v.optional(v.string()),
      }),
    ),
    albumId: v.optional(v.id("albums")),
    deletedAt: v.optional(v.number()),
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

  // A private reading list. One row per viewer and post. The post visibility
  // policy still applies when the list is read.
  savedPosts: defineTable({
    userId: v.id("users"),
    postId: v.id("posts"),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_post", ["userId", "postId"])
    .index("by_post", ["postId"]),

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

  // Materialized accepted-friend adjacency. Each accepted friendship has two
  // rows so a user's complete friend list is one indexed paginated query.
  // The friendships table remains the source of truth for pair lifecycle.
  friendEdges: defineTable({
    userId: v.id("users"),
    friendId: v.id("users"),
    friendshipId: v.id("friendships"),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_friend", ["userId", "friendId"])
    .index("by_friend", ["friendId"]),

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
    .index("by_actor", ["actorId"])
    .index("by_post", ["postId"])
    .index("by_created", ["createdAt"]),

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
    .index("by_sender", ["senderId"])
    .searchIndex("search_body", { searchField: "body" }),

  // Billing mirror, keyed by user, kept in sync by the Stripe webhook (billing.ts).
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: planValidator,
    status: subscriptionStatusValidator,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    stripeEventCreatedAt: v.optional(v.number()),
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
  })
    .index("by_user_action", ["userId", "action"])
    .index("by_window", ["windowStart"]),

  uploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    used: v.boolean(),
    size: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"])
    .index("by_created", ["createdAt"])
    .index("by_used_created", ["used", "createdAt"]),

  // A short-lived admission receipt for each client upload URL. It reserves
  // declared plan capacity before Convex accepts bytes and binds registration
  // to one user, media kind, size, and storage object.
  uploadGrants: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("image"), v.literal("video")),
    declaredBytes: v.number(),
    active: v.boolean(),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_active_created", ["userId", "active", "createdAt"])
    .index("by_created", ["createdAt"]),

  pairLocks: defineTable({
    kind: v.string(),
    pairKey: v.string(),
    userA: v.optional(v.id("users")),
    userB: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_kind_key", ["kind", "pairKey"])
    .index("by_user_a", ["userA"])
    .index("by_user_b", ["userB"]),

  mutes: defineTable({
    muterId: v.id("users"),
    mutedId: v.id("users"),
    pairKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_pair", ["pairKey"])
    .index("by_muter", ["muterId"])
    .index("by_muted", ["mutedId"]),

  reports: defineTable({
    reporterId: v.id("users"),
    targetUserId: v.optional(v.id("users")),
    postId: v.optional(v.id("posts")),
    reason: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  })
    .index("by_reporter", ["reporterId"])
    .index("by_reporter_post_status", ["reporterId", "postId", "status"])
    .index("by_reporter_target_status", ["reporterId", "targetUserId", "status"])
    .index("by_post", ["postId"])
    .index("by_target_user", ["targetUserId"])
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
    memberCount: v.optional(v.number()),
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
    goingCount: v.optional(v.number()),
    interestedCount: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
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

  conversationTyping: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_conversation_user", ["conversationId", "userId"])
    .index("by_user", ["userId"])
    .index("by_updated", ["updatedAt"]),

  albums: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    itemCount: v.optional(v.number()),
    coverImageIds: v.optional(v.array(v.id("_storage"))),
  }).index("by_owner", ["ownerId"]),

  albumItems: defineTable({
    albumId: v.id("albums"),
    imageId: v.id("_storage"),
    postId: v.optional(v.id("posts")),
    createdAt: v.number(),
  }).index("by_album", ["albumId"]),

  // Small operational heartbeat table. It contains no user data or secrets.
  // Readiness checks use it to detect a stalled scheduler or maintenance loop.
  opsState: defineTable({
    key: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    updatedAt: v.number(),
    release: v.string(),
    detail: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // Resumable cursors for bounded maintenance sweeps over system tables.
  maintenanceCursors: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Exact per-user counters avoid unbounded scans for badges and plan gates.
  userStats: defineTable({
    userId: v.id("users"),
    postCount: v.number(),
    notificationUnreadCount: v.number(),
    messageUnreadCount: v.number(),
    friendCount: v.optional(v.number()),
    storageBytes: v.optional(v.number()),
    uploadCount: v.optional(v.number()),
    postCountExact: v.optional(v.boolean()),
    notificationUnreadCountExact: v.optional(v.boolean()),
    messageUnreadCountExact: v.optional(v.boolean()),
    friendCountExact: v.optional(v.boolean()),
    storageBytesExact: v.optional(v.boolean()),
    uploadCountExact: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Durable external-delivery outbox. Mutations enqueue a document first;
  // a cron-dispatched action performs the provider call and records retries.
  deliveryJobs: defineTable({
    dedupeKey: v.string(),
    subjectUserId: v.optional(v.id("users")),
    payload: v.union(
      v.object({
        kind: v.literal("email"),
        to: v.string(),
        subject: v.string(),
        text: v.optional(v.string()),
        html: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("push"),
        userId: v.id("users"),
        title: v.string(),
        body: v.string(),
        url: v.optional(v.string()),
      }),
      v.object({
        kind: v.literal("stripe_cancel"),
        stripeSubscriptionId: v.string(),
      }),
      v.object({
        kind: v.literal("clerk_delete"),
        clerkUserId: v.string(),
      }),
    ),
    state: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("succeeded"),
      v.literal("dead"),
      v.literal("canceled"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    providerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_dedupe", ["dedupeKey"])
    .index("by_subject", ["subjectUserId"])
    .index("by_state_next", ["state", "nextAttemptAt"]),

  // Minimal Stripe event receipts make webhook application idempotent and
  // allow old, out-of-order events to be ignored without storing payloads.
  stripeWebhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    eventCreatedAt: v.number(),
    outcome: v.union(v.literal("applied"), v.literal("ignored")),
    receivedAt: v.number(),
    detail: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_received", ["receivedAt"]),

  // Account removal is an immediate tombstone followed by resumable,
  // bounded cleanup. The job contains no user content or credentials.
  accountDeletionJobs: defineTable({
    userId: v.id("users"),
    phase: v.string(),
    requestedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failureCount: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_completed_updated", ["completedAt", "updatedAt"]),

  // Resumable production data migrations. Cursors contain only opaque Convex
  // pagination state. Readiness stays red while a required migration runs.
  migrationJobs: defineTable({
    key: v.string(),
    phase: v.string(),
    cursor: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("complete")),
    processed: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_status_updated", ["status", "updatedAt"]),

  // Ephemeral rows used only by the authenticated production load endpoint.
  // The write probe inserts and deletes one row in the same transaction.
  loadProbeSamples: defineTable({
    nonce: v.string(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // Redacted browser failures. No user id, email address, request payload, or
  // source address is stored. Source hashes exist only in the rate-limit table.
  clientErrors: defineTable({
    fingerprint: v.string(),
    kind: v.union(v.literal("error"), v.literal("unhandledrejection")),
    message: v.string(),
    stack: v.optional(v.string()),
    route: v.string(),
    release: v.string(),
    environment: v.string(),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_fingerprint_created", ["fingerprint", "createdAt"]),

  clientErrorRateLimits: defineTable({
    sourceHash: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_source_window", ["sourceHash", "windowStart"])
    .index("by_window", ["windowStart"]),
});
