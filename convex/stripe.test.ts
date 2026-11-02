import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

describe("Stripe webhook ordering", () => {
  it("applies each event once and rejects older state", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      await ctx.db.insert("users", { email: "stripe@example.test" } as any),
    );
    const first = await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_new",
      eventType: "customer.subscription.updated",
      eventCreatedAt: 2_000,
      userId,
      status: "active",
      stripeSubscriptionId: "sub_ordered",
    });
    expect(first.outcome).toBe("applied");

    const duplicate = await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_new",
      eventType: "customer.subscription.updated",
      eventCreatedAt: 2_000,
      userId,
      status: "past_due",
      stripeSubscriptionId: "sub_ordered",
    });
    expect(duplicate.outcome).toBe("duplicate");

    const stale = await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_old",
      eventType: "customer.subscription.updated",
      eventCreatedAt: 1_000,
      userId,
      status: "past_due",
      stripeSubscriptionId: "sub_ordered",
    });
    expect(stale.outcome).toBe("ignored");

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(subscription?.status).toBe("active");
      expect(subscription?.stripeEventCreatedAt).toBe(2_000);
      expect(await ctx.db.query("stripeWebhookEvents").collect()).toHaveLength(2);
    });
  });

  it("does not let an old update revive a deleted subscription", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      await ctx.db.insert("users", { email: "cancel@example.test" } as any),
    );
    await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_active",
      eventType: "customer.subscription.created",
      eventCreatedAt: 1_000,
      userId,
      status: "active",
      stripeSubscriptionId: "sub_deleted",
    });
    await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_deleted",
      eventType: "customer.subscription.deleted",
      eventCreatedAt: 3_000,
      stripeSubscriptionId: "sub_deleted",
    });
    await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_late",
      eventType: "customer.subscription.updated",
      eventCreatedAt: 2_000,
      userId,
      status: "active",
      stripeSubscriptionId: "sub_deleted",
    });
    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(subscription?.status).toBe("canceled");
      expect(subscription?.plan).toBe("free");
    });
  });
});
