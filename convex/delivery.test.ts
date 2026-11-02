import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

describe("durable delivery outbox", () => {
  it("deduplicates jobs and makes terminal provider failures visible", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.billing.cancelAtStripe, {
      stripeSubscriptionId: "sub_same",
    });
    const second = await t.mutation(internal.billing.cancelAtStripe, {
      stripeSubscriptionId: "sub_same",
    });
    expect(second).toBe(first);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("deliveryJobs").collect();
      expect(rows).toHaveLength(1);
      await ctx.db.patch(rows[0]._id, { state: "processing", attempts: 8 });
    });
    await t.mutation(internal.delivery.fail, {
      jobId: first,
      error: "provider\nsecret-free error",
    });

    const status = await t.query(internal.delivery.status, { now: Date.now() });
    expect(status).toEqual({ ready: false, dead: 1, overdue: 0 });
    await t.run(async (ctx) => {
      const job = await ctx.db.get(first);
      expect(job?.state).toBe("dead");
      expect(job?.lastError).toBe("provider secret-free error");
    });

    await expect(t.mutation(internal.delivery.retryDead, { jobId: first })).resolves.toEqual({
      outcome: "pending",
    });
    await t.run(async (ctx) => {
      const job = await ctx.db.get(first);
      expect(job).toMatchObject({ state: "pending", attempts: 0 });
      await ctx.db.patch(first, { state: "dead" });
    });
    await expect(t.mutation(internal.delivery.cancelDead, {
      jobId: first,
      reason: "provider rejected the retired address",
    })).resolves.toEqual({ outcome: "canceled" });
    expect(await t.query(internal.delivery.status, { now: Date.now() })).toEqual({
      ready: true,
      dead: 0,
      overdue: 0,
    });
  });

  it("records successful completion without exposing the payload", async () => {
    const t = convexTest(schema, modules);
    const jobId = await t.mutation(internal.billing.cancelAtStripe, {
      stripeSubscriptionId: "sub_ok",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { state: "processing" });
    });
    await t.mutation(internal.delivery.succeed, { jobId, providerId: "provider-1" });
    await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      expect(job?.state).toBe("succeeded");
      expect(job?.completedAt).toBeTypeOf("number");
      expect(job?.providerId).toBe("provider-1");
    });
  });

  it("links provider work to its user and ignores stale terminal callbacks", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { email: "owner@example.test" });
      await ctx.db.insert("subscriptions", {
        userId: id,
        plan: "pro",
        status: "active",
        stripeSubscriptionId: "sub_owned",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return id;
    });
    const jobId = await t.mutation(internal.billing.cancelAtStripe, {
      stripeSubscriptionId: "sub_owned",
    });
    await t.mutation(internal.delivery.succeed, { jobId, providerId: "too-early" });
    await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      expect(job?.subjectUserId).toBe(userId);
      expect(job?.state).toBe("pending");
      expect(job?.providerId).toBeUndefined();
    });
  });
});
