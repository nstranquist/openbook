import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  assertSafeReturnUrl,
  createCheckoutSession,
  createBillingPortalSession,
  stripeProPriceId,
} from "./lib/stripe";
import { planValidator, subscriptionStatusValidator } from "./schema";
import { effectivePlan, planLimits } from "./lib/plans";
import type { Id } from "./_generated/dataModel";
import { profileOf } from "./lib/social";

// Billing wires Stripe (TEST mode) against the schema-ready subscriptions table.
// Flow: dashboard calls billing.createCheckout → Stripe-hosted Checkout → user
// pays → Stripe POSTs to http.ts /stripe/webhook → billing.upsertSubscription
// mirrors it and the gates (lib/plans.effectivePlan) read from here. The server
// never stores card data.

// createCheckout opens a Pro-tier subscription Checkout for the signed-in user.
export const createCheckout = action({
  args: { successUrl: v.string(), cancelUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) return { userId: null, email: null, stripeCustomerId: null };
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
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const plan = await effectivePlan(ctx, userId);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", userId))
      .collect();
    return {
      plan,
      limits: planLimits(plan),
      usage: { posts: posts.length },
      status: sub?.status ?? null,
      hasStripeCustomer: !!sub?.stripeCustomerId,
    };
  },
});

// --- Webhook-driven state sync (the ONLY writers of subscriptions) ----------

export const upsertSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    plan: planValidator,
    status: subscriptionStatusValidator,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        plan: args.plan,
        status: args.status,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId ?? existing.stripeSubscriptionId,
        currentPeriodEnd: args.currentPeriodEnd ?? existing.currentPeriodEnd,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        plan: args.plan,
        status: args.status,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        currentPeriodEnd: args.currentPeriodEnd,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const cancelSubscription = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, { stripeSubscriptionId }) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId),
      )
      .unique();
    if (!sub) return;
    await ctx.db.patch(sub._id, { status: "canceled", plan: "free", updatedAt: Date.now() });
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
