import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordOpsState } from "./lib/ops";

const DISPATCH_BATCH = 25;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

function retryDelay(attempts: number): number {
  return RETRY_MS[Math.min(Math.max(attempts - 1, 0), RETRY_MS.length - 1)] ?? 6 * 60 * 60_000;
}

export const dispatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("deliveryJobs")
      .withIndex("by_state_next", (q) =>
        q.eq("state", "processing").lte("nextAttemptAt", now),
      )
      .take(DISPATCH_BATCH);
    for (const job of expired) {
      await ctx.db.patch(job._id, {
        state: "pending",
        nextAttemptAt: now,
        updatedAt: now,
        lastError: "delivery lease expired",
      });
    }

    const pending = await ctx.db
      .query("deliveryJobs")
      .withIndex("by_state_next", (q) =>
        q.eq("state", "pending").lte("nextAttemptAt", now),
      )
      .take(DISPATCH_BATCH);
    for (const job of pending) {
      await ctx.db.patch(job._id, {
        state: "processing",
        attempts: job.attempts + 1,
        nextAttemptAt: now + LEASE_MS,
        updatedAt: now,
        lastError: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.deliveryWorker.run, { jobId: job._id });
    }
    await recordOpsState(
      ctx,
      "delivery",
      "ok",
      `dispatched=${pending.length} recovered=${expired.length}`,
    );
    const hasMore = pending.length === DISPATCH_BATCH || expired.length === DISPATCH_BATCH;
    if (hasMore) await ctx.scheduler.runAfter(0, internal.delivery.dispatch, {});
    return { dispatched: pending.length, recovered: expired.length, hasMore };
  },
});

export const get = internalQuery({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }) => await ctx.db.get(jobId),
});

export const succeed = internalMutation({
  args: { jobId: v.id("deliveryJobs"), providerId: v.optional(v.string()) },
  handler: async (ctx, { jobId, providerId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing") return;
    const now = Date.now();
    await ctx.db.patch(jobId, {
      state: "succeeded",
      providerId: providerId?.slice(0, 512),
      completedAt: now,
      updatedAt: now,
      lastError: undefined,
      nextAttemptAt: now,
    });
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("deliveryJobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing") return;
    const now = Date.now();
    const dead = job.attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(jobId, {
      state: dead ? "dead" : "pending",
      nextAttemptAt: dead ? now : now + retryDelay(job.attempts),
      updatedAt: now,
      lastError: error.replace(/[\r\n]+/g, " ").slice(0, 240),
    });
    if (dead) await recordOpsState(ctx, "delivery", "error", `dead_job=${jobId}`);
  },
});

export const retryDead = internalMutation({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "dead") throw new Error("Dead delivery job not found");
    const now = Date.now();
    await ctx.db.patch(jobId, {
      state: "pending",
      attempts: 0,
      nextAttemptAt: now,
      updatedAt: now,
      lastError: undefined,
      providerId: undefined,
      completedAt: undefined,
    });
    await recordOpsState(ctx, "delivery", "ok", `retry_queued=${jobId}`);
    await ctx.scheduler.runAfter(0, internal.delivery.dispatch, {});
    return { outcome: "pending" as const };
  },
});

export const cancelDead = internalMutation({
  args: { jobId: v.id("deliveryJobs"), reason: v.string() },
  handler: async (ctx, { jobId, reason }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "dead") throw new Error("Dead delivery job not found");
    const note = reason.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
    if (!note) throw new Error("Cancellation reason is required");
    const now = Date.now();
    await ctx.db.patch(jobId, {
      state: "canceled",
      nextAttemptAt: now,
      updatedAt: now,
      completedAt: now,
      lastError: `operator canceled: ${note}`,
    });
    await recordOpsState(ctx, "delivery", "ok", `canceled_job=${jobId}`);
    return { outcome: "canceled" as const };
  },
});

export const status = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const [dead, overdue] = await Promise.all([
      ctx.db
        .query("deliveryJobs")
        .withIndex("by_state_next", (q) => q.eq("state", "dead"))
        .take(1),
      ctx.db
        .query("deliveryJobs")
        .withIndex("by_state_next", (q) =>
          q.eq("state", "pending").lt("nextAttemptAt", now - 15 * 60 * 1000),
        )
        .take(1),
    ]);
    return { ready: dead.length === 0 && overdue.length === 0, dead: dead.length, overdue: overdue.length };
  },
});
