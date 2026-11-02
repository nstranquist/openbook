import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { modules } from "./test.setup";

// Billing-sync + plan-gating against the real schema. The gate DENIES work on the
// free tier and the webhook mappings flip plans, so a wrong edit either lets free
// users exceed limits or fails to grant paid access — both worth pinning.

async function newUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "u@e.com" } as any);
    const now = Date.now();
    await ctx.db.insert("profiles", {
      userId,
      displayName: "Billing user",
      avatarHue: 1,
      coverHue: 2,
      joinedAt: now,
    });
    await ctx.db.insert("userStats", {
      userId,
      postCount: 0,
      notificationUnreadCount: 0,
      messageUnreadCount: 0,
      storageBytes: 0,
      uploadCount: 0,
      postCountExact: true,
      notificationUnreadCountExact: true,
      messageUnreadCountExact: true,
      storageBytesExact: true,
      uploadCountExact: true,
      updatedAt: now,
    });
    return userId;
  });
}

describe("billing webhook sync", () => {
  it("removes a closed account from the external billing context", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t);
    const as = t.withIdentity({ subject: userId });
    await as.mutation(api.profiles.ensure, { displayName: "Closing user" });
    expect((await as.query(internal.billing.billingContext, {})).userId).toBe(userId);
    await as.mutation(api.profiles.deleteAccount, {});
    expect(await as.query(internal.billing.billingContext, {})).toEqual({
      userId: null,
      email: null,
      stripeCustomerId: null,
    });
  });

  it("upsertSubscription grants pro; cancelSubscription drops to free", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t);
    const as = t.withIdentity({ subject: userId });

    expect((await as.query(api.billing.getMyPlan, {}))?.plan).toBe("free");

    await t.mutation(internal.billing.upsertSubscription, {
      userId, plan: "pro", status: "active", stripeSubscriptionId: "sub_1",
    });
    expect((await as.query(api.billing.getMyPlan, {}))?.plan).toBe("pro");

    await t.mutation(internal.billing.cancelSubscription, { stripeSubscriptionId: "sub_1" });
    expect((await as.query(api.billing.getMyPlan, {}))?.plan).toBe("free");
  });

  it("a past_due subscription is not entitling (falls back to free)", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t);
    const as = t.withIdentity({ subject: userId });
    await t.mutation(internal.billing.upsertSubscription, {
      userId, plan: "pro", status: "past_due", stripeSubscriptionId: "sub_2",
    });
    expect((await as.query(api.billing.getMyPlan, {}))?.plan).toBe("free");
  });
});

describe("plan gate on posts.create", () => {
  it("free tier is capped; an active pro subscription lifts the cap", async () => {
    const t = convexTest(schema, modules);
    const userId = await newUser(t);
    const as = t.withIdentity({ subject: userId });
    await as.mutation(api.profiles.ensure, { displayName: "Plan user" });

    // Seed the free limit (100 posts) directly, then the next create must be rejected.
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) {
        await ctx.db.insert("posts", {
          body: `p${i}`, authorId: userId, audience: "public", createdAt: Date.now(),
          commentCount: 0,
          reactionCounts: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
        });
      }
      const stats = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!stats) throw new Error("Missing user statistics");
      await ctx.db.patch(stats._id, { postCount: 100 });
    });
    await expect(
      as.mutation(api.posts.create, { body: "over", audience: "public" }),
    ).rejects.toThrow(/Plan limit/);

    // Upgrade → the cap lifts.
    await t.mutation(internal.billing.upsertSubscription, {
      userId, plan: "pro", status: "active", stripeSubscriptionId: "sub_3",
    });
    await expect(
      as.mutation(api.posts.create, { body: "now-allowed", audience: "public" }),
    ).resolves.toBeDefined();
  });
});
