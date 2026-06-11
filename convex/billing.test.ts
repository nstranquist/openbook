import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { modules } from "./test.setup";

// Billing-sync + plan-gating against the real schema. The gate DENIES work on the
// free tier and the webhook mappings flip plans, so a wrong edit either lets free
// users exceed limits or fails to grant paid access — both worth pinning.

async function newUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.insert("users", { email: "u@e.com" } as any));
}

describe("billing webhook sync", () => {
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

    // Seed the free limit (100 posts) directly, then the next create must be rejected.
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) {
        await ctx.db.insert("posts", {
          body: `p${i}`, authorId: userId, audience: "public", createdAt: Date.now(),
          commentCount: 0,
          reactionCounts: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
        });
      }
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
