import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  assertSafeReturnUrl,
  createCheckoutSession,
  createBillingPortalSession,
  stripeProPriceId,
} from "./lib/stripe";
import { planValidator, subscriptionStatusValidator } from "./schema";
import { effectivePlan, planLimits } from "./lib/plans";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { profileOf, requireActiveUser } from "./lib/social";
import { userStats } from "./lib/stats";
import { enqueueDelivery } from "./lib/delivery";
import { billingIsEnabled } from "./lib/runtime";

// Billing wires Stripe (TEST mode) against the schema-ready subscriptions table.
// Flow: dashboard calls billing.createCheckout → Stripe-hosted Checkout → user
// pays → Stripe POSTs to http.ts /stripe/webhook → billing.upsertSubscription
// mirrors it and the gates (lib/plans.effectivePlan) read from here. The server
// never stores card data.

// createCheckout opens a Pro-tier subscription Checkout for the signed-in user.
export const createCheckout = action({
  args: { successUrl: v.string(), cancelUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    if (!billingIsEnabled()) throw new Error("Billing is not enabled");
    const ctxInfo = await ctx.runQuery(internal.billing.billingContext, {});
    if (!ctxInfo.userId) throw new Error("Not authenticated");
    assertSafeReturnUrl(args.successUrl);
    assertSafeReturnUrl(args.cancelUrl);
    const session = await createCheckoutSession({
      priceId: stripeProPriceId(),
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl,
      clientReferenceId: ctxInfo.userId,
      customerEmail: ctxInfo.email ?? undefined,
      stripeCustomerId: ctxInfo.stripeCustomerId ?? undefined,
    });
    return { url: session.url };
  },
});

// createPortal opens the Stripe billing portal for a user that already has a
// Stripe customer (i.e. has checked out at least once).
export const createPortal = action({
  args: { returnUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    if (!billingIsEnabled()) throw new Error("Billing is not enabled");
    const ctxInfo = await ctx.runQuery(internal.billing.billingContext, {});
    if (!ctxInfo.userId) throw new Error("Not authenticated");
    if (!ctxInfo.stripeCustomerId) {
      throw new Error("No Stripe customer yet — start a checkout first");
    }
    assertSafeReturnUrl(args.returnUrl);
    const session = await createBillingPortalSession({
      stripeCustomerId: ctxInfo.stripeCustomerId,
      returnUrl: args.returnUrl,
    });
    return { url: session.url };
  },
});

// billingContext resolves the caller + any existing Stripe customer. Internal —
// only the billing actions call it (actions have no db handle).
export const billingContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireActiveUser(ctx).catch(() => null);
    if (!userId) return { userId: null, email: null, stripeCustomerId: null };
    const profile = await profileOf(ctx, userId);
    if (!profile || profile.deletedAt) {
      return { userId: null, email: null, stripeCustomerId: null };
    }
    const user = await ctx.db.get(userId);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      userId: userId as string,
      email: (user as any)?.email ?? null,
      stripeCustomerId: sub?.stripeCustomerId ?? null,
    };
  },
});

// getMyPlan returns the caller's effective plan + limits for the dashboard.
export const getMyPlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireActiveUser(ctx).catch(() => null);
    if (!userId) return null;
    const plan = await effectivePlan(ctx, userId);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const stats = await userStats(ctx, userId);
    const fallbackLimit = planLimits(plan).posts ?? 1_000;
    const fallbackPosts = stats?.postCountExact
      ? null
      : await ctx.db
          .query("posts")
          .withIndex("by_author", (q) => q.eq("authorId", userId))
          .take(fallbackLimit + 1);
    return {
      plan,
      billingEnabled: billingIsEnabled(),
      limits: planLimits(plan),
      usage: {
        posts: stats?.postCountExact ? stats.postCount : fallbackPosts?.length ?? 0,
        postsIsLowerBound: !stats?.postCountExact && (fallbackPosts?.length ?? 0) > fallbackLimit,
        storageBytes: stats?.storageBytes ?? 0,
        uploads: stats?.uploadCount ?? 0,
        storageIsExact:
          stats?.storageBytesExact === true && stats?.uploadCountExact === true,
      },
      status: sub?.status ?? null,
      hasStripeCustomer: !!sub?.stripeCustomerId,
    };
  },
});

// --- Webhook-driven state sync (the ONLY writers of subscriptions) ----------

type SubscriptionUpdate = {
  userId: Id<"users">;
  plan: "free" | "pro";
  status: "active" | "trialing" | "past_due" | "canceled";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: number;
  stripeEventCreatedAt?: number;
};

async function writeSubscription(
  ctx: MutationCtx,
  args: SubscriptionUpdate,
): Promise<boolean> {
  const now = Date.now();
  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();
  if (
    existing &&
    args.stripeEventCreatedAt !== undefined &&
    (existing.stripeEventCreatedAt ?? 0) > args.stripeEventCreatedAt
  ) {
    return false;
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      plan: args.plan,
      status: args.status,
      stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId ?? existing.stripeSubscriptionId,
      currentPeriodEnd: args.currentPeriodEnd ?? existing.currentPeriodEnd,
      stripeEventCreatedAt: args.stripeEventCreatedAt ?? existing.stripeEventCreatedAt,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("subscriptions", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  }
  return true;
}

export const upsertSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    plan: planValidator,
    status: subscriptionStatusValidator,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    stripeEventCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await writeSubscription(ctx, args),
});

export const applyStripeEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    eventCreatedAt: v.number(),
    userId: v.optional(v.string()),
    status: v.optional(subscriptionStatusValidator),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existingEvent) return { outcome: "duplicate" as const };

    let outcome: "applied" | "ignored" = "ignored";
    let detail = "unsupported or incomplete event";
    if (args.eventType === "customer.subscription.deleted" && args.stripeSubscriptionId) {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripe_subscription", (q) =>
          q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
        )
        .unique();
      if (sub && (sub.stripeEventCreatedAt ?? 0) <= args.eventCreatedAt) {
        await ctx.db.patch(sub._id, {
          status: "canceled",
          plan: "free",
          stripeEventCreatedAt: args.eventCreatedAt,
          updatedAt: Date.now(),
        });
        outcome = "applied";
        detail = "subscription canceled";
      } else {
        detail = sub ? "stale event" : "subscription not found";
      }
    } else if (args.userId && args.status) {
      const userId = ctx.db.normalizeId("users", args.userId);
      const user = userId ? await ctx.db.get(userId) : null;
      const profile = userId ? await profileOf(ctx, userId) : null;
      if (userId && user && !profile?.deletedAt) {
        const applied = await writeSubscription(ctx, {
          userId,
          plan: args.status === "active" || args.status === "trialing" ? "pro" : "free",
          status: args.status,
          stripeCustomerId: args.stripeCustomerId,
          stripeSubscriptionId: args.stripeSubscriptionId,
          currentPeriodEnd: args.currentPeriodEnd,
          stripeEventCreatedAt: args.eventCreatedAt,
        });
        outcome = applied ? "applied" : "ignored";
        detail = applied ? "subscription synchronized" : "stale event";
      } else {
        detail = "user not active";
      }
    }
    await ctx.db.insert("stripeWebhookEvents", {
      eventId: args.eventId.slice(0, 255),
      eventType: args.eventType.slice(0, 255),
      eventCreatedAt: args.eventCreatedAt,
      outcome,
      receivedAt: Date.now(),
      detail,
    });
    return { outcome };
  },
});

export const cancelAtStripe = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, { stripeSubscriptionId }) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId),
      )
      .unique();
    return await enqueueDelivery(
      ctx,
      `stripe-cancel:${stripeSubscriptionId}`,
      { kind: "stripe_cancel", stripeSubscriptionId },
      subscription?.userId,
    );
  },
});

export const cancelSubscription = internalMutation({
  args: { stripeSubscriptionId: v.string(), eventCreatedAt: v.optional(v.number()) },
  handler: async (ctx, { stripeSubscriptionId, eventCreatedAt }) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId),
      )
      .unique();
    if (!sub) return;
    if (eventCreatedAt !== undefined && (sub.stripeEventCreatedAt ?? 0) > eventCreatedAt) return;
    await ctx.db.patch(sub._id, {
      status: "canceled",
      plan: "free",
      stripeEventCreatedAt: eventCreatedAt ?? sub.stripeEventCreatedAt,
      updatedAt: Date.now(),
    });
  },
});

// userExists guards the webhook against a malformed/replayed event referencing a
// deleted user — a no-op rather than a throw.
export const userExists = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    try {
      const user = await ctx.db.get(userId as Id<"users">);
      if (!user) return false;
      const profile = await profileOf(ctx, userId as Id<"users">);
      if (profile?.deletedAt) return false;
      return true;
    } catch {
      return false;
    }
  },
});
