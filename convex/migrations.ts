import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ensureUserStats } from "./lib/stats";
import { recordOpsState } from "./lib/ops";
import { REQUIRED_USER_STATS_MIGRATION } from "./lib/limits";
import { ensureFriendEdges } from "./lib/social";

const PAGE_SIZE = 50;
const MIGRATION_STALE_MS = 10 * 60 * 1000;

const PHASES = [
  "initialize",
  "friend_edges_clear",
  "posts",
  "notifications",
  "messages",
  "friendships",
  "uploads",
  "finalize",
  "complete",
] as const;
type Phase = (typeof PHASES)[number];

async function userStatsJob(ctx: MutationCtx) {
  return await ctx.db
    .query("migrationJobs")
    .withIndex("by_key", (q) => q.eq("key", REQUIRED_USER_STATS_MIGRATION))
    .unique();
}

function nextPhase(phase: Phase): Phase {
  const index = PHASES.indexOf(phase);
  return PHASES[Math.min(index + 1, PHASES.length - 1)] ?? "complete";
}

async function scheduleNext(
  ctx: MutationCtx,
  job: Doc<"migrationJobs">,
  phase: Phase,
  cursor: string | undefined,
  processed: number,
): Promise<void> {
  await ctx.db.patch(job._id, {
    phase,
    cursor,
    processed: job.processed + processed,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.migrations.stepUserStats, {});
}

async function addCounts(
  ctx: MutationCtx,
  counts: Map<Id<"users">, number>,
  field: "postCount" | "notificationUnreadCount" | "messageUnreadCount" | "friendCount",
): Promise<void> {
  for (const [userId, count] of counts) {
    const stats = await ensureUserStats(ctx, userId);
    await ctx.db.patch(stats._id, {
      [field]: (stats[field] ?? 0) + count,
      updatedAt: Date.now(),
    });
  }
}

export const startUserStats = internalMutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, { reset }) => {
    if (reset && process.env.OPENBOOK_ENV === "production") {
      throw new Error("Production counter migrations cannot be reset");
    }
    const existing = await userStatsJob(ctx);
    if (existing?.status === "complete" && !reset) {
      return { status: "complete" as const, processed: existing.processed };
    }
    if (existing?.status === "running" && !reset) {
      await ctx.scheduler.runAfter(0, internal.migrations.stepUserStats, {});
      return { status: "running" as const, processed: existing.processed };
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        phase: "initialize",
        cursor: undefined,
        status: "running",
        processed: 0,
        startedAt: now,
        updatedAt: now,
        completedAt: undefined,
      });
    } else {
      await ctx.db.insert("migrationJobs", {
        key: REQUIRED_USER_STATS_MIGRATION,
        phase: "initialize",
        status: "running",
        processed: 0,
        startedAt: now,
        updatedAt: now,
      });
    }
    await recordOpsState(
      ctx,
      REQUIRED_USER_STATS_MIGRATION,
      "error",
      "required counter and storage migration running",
    );
    await ctx.scheduler.runAfter(0, internal.migrations.stepUserStats, {});
    return { status: "running" as const, processed: 0 };
  },
});

export const stepUserStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const job = await userStatsJob(ctx);
    if (!job || job.status !== "running") return { outcome: "ignored" as const };
    if (!PHASES.includes(job.phase as Phase)) throw new Error("Unknown user statistics migration phase");
    const phase = job.phase as Phase;
    const paginationOpts = { numItems: PAGE_SIZE, cursor: job.cursor ?? null };

    if (phase === "initialize" || phase === "finalize") {
      const page = await ctx.db.query("profiles").order("asc").paginate(paginationOpts);
      for (const profile of page.page) {
        const stats = await ensureUserStats(ctx, profile.userId);
        if (phase === "initialize") {
          await ctx.db.patch(stats._id, {
            postCount: 0,
            notificationUnreadCount: 0,
            messageUnreadCount: 0,
            friendCount: 0,
            storageBytes: 0,
            uploadCount: 0,
            postCountExact: false,
            notificationUnreadCountExact: false,
            messageUnreadCountExact: false,
            friendCountExact: false,
            storageBytesExact: false,
            uploadCountExact: false,
            updatedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(stats._id, {
            postCountExact: true,
            notificationUnreadCountExact: true,
            messageUnreadCountExact: true,
            friendCountExact: true,
            storageBytesExact: true,
            uploadCountExact: true,
            updatedAt: Date.now(),
          });
        }
      }
      await scheduleNext(
        ctx,
        job,
        page.isDone ? nextPhase(phase) : phase,
        page.isDone ? undefined : page.continueCursor,
        page.page.length,
      );
      return { outcome: "running" as const, phase };
    }

    if (phase === "friend_edges_clear") {
      const rows = await ctx.db.query("friendEdges").take(PAGE_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      await scheduleNext(
        ctx,
        job,
        rows.length === 0 ? nextPhase(phase) : phase,
        undefined,
        rows.length,
      );
      return { outcome: "running" as const, phase };
    }

    if (phase === "posts") {
      const page = await ctx.db.query("posts").withIndex("by_created").paginate(paginationOpts);
      const counts = new Map<Id<"users">, number>();
      for (const row of page.page) {
        if (!row.deletedAt) counts.set(row.authorId, (counts.get(row.authorId) ?? 0) + 1);
      }
      await addCounts(ctx, counts, "postCount");
      await scheduleNext(ctx, job, page.isDone ? nextPhase(phase) : phase, page.isDone ? undefined : page.continueCursor, page.page.length);
      return { outcome: "running" as const, phase };
    }

    if (phase === "notifications") {
      const page = await ctx.db.query("notifications").withIndex("by_created").paginate(paginationOpts);
      const counts = new Map<Id<"users">, number>();
      for (const row of page.page) {
        if (!row.read) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
      }
      await addCounts(ctx, counts, "notificationUnreadCount");
      await scheduleNext(ctx, job, page.isDone ? nextPhase(phase) : phase, page.isDone ? undefined : page.continueCursor, page.page.length);
      return { outcome: "running" as const, phase };
    }

    if (phase === "messages") {
      const page = await ctx.db.query("conversationMembers").withIndex("by_user").paginate(paginationOpts);
      const counts = new Map<Id<"users">, number>();
      for (const row of page.page) {
        counts.set(row.userId, (counts.get(row.userId) ?? 0) + row.unreadCount);
      }
      await addCounts(ctx, counts, "messageUnreadCount");
      await scheduleNext(ctx, job, page.isDone ? nextPhase(phase) : phase, page.isDone ? undefined : page.continueCursor, page.page.length);
      return { outcome: "running" as const, phase };
    }

    if (phase === "friendships") {
      const page = await ctx.db.query("friendships").order("asc").paginate(paginationOpts);
      const counts = new Map<Id<"users">, number>();
      for (const row of page.page) {
        if (row.status !== "accepted") continue;
        const existingEdge = await ctx.db
          .query("friendEdges")
          .withIndex("by_user_friend", (q) =>
            q.eq("userId", row.requesterId).eq("friendId", row.addresseeId),
          )
          .first();
        if (existingEdge) {
          await ctx.db.delete(row._id);
          continue;
        }
        await ensureFriendEdges(
          ctx,
          row._id,
          row.requesterId,
          row.addresseeId,
          row.respondedAt ?? row.createdAt,
        );
        counts.set(row.requesterId, (counts.get(row.requesterId) ?? 0) + 1);
        counts.set(row.addresseeId, (counts.get(row.addresseeId) ?? 0) + 1);
      }
      await addCounts(ctx, counts, "friendCount");
      await scheduleNext(ctx, job, page.isDone ? nextPhase(phase) : phase, page.isDone ? undefined : page.continueCursor, page.page.length);
      return { outcome: "running" as const, phase };
    }

    if (phase === "uploads") {
      const page = await ctx.db
        .query("uploads")
        .withIndex("by_created")
        .paginate(paginationOpts);
      const counts = new Map<Id<"users">, { bytes: number; files: number }>();
      for (const row of page.page) {
        const metadata = row.size === undefined ? await ctx.db.system.get(row.storageId) : null;
        const size = row.size ?? metadata?.size ?? 0;
        if (row.size === undefined && size > 0) await ctx.db.patch(row._id, { size });
        const current = counts.get(row.userId) ?? { bytes: 0, files: 0 };
        counts.set(row.userId, { bytes: current.bytes + size, files: current.files + 1 });
      }
      for (const [userId, count] of counts) {
        const stats = await ensureUserStats(ctx, userId);
        await ctx.db.patch(stats._id, {
          storageBytes: (stats.storageBytes ?? 0) + count.bytes,
          uploadCount: (stats.uploadCount ?? 0) + count.files,
          updatedAt: Date.now(),
        });
      }
      await scheduleNext(
        ctx,
        job,
        page.isDone ? nextPhase(phase) : phase,
        page.isDone ? undefined : page.continueCursor,
        page.page.length,
      );
      return { outcome: "running" as const, phase };
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      phase: "complete",
      cursor: undefined,
      status: "complete",
      completedAt: now,
      updatedAt: now,
    });
    await recordOpsState(ctx, REQUIRED_USER_STATS_MIGRATION, "ok", `processed=${job.processed}`);
    return { outcome: "complete" as const, processed: job.processed };
  },
});

export const userStatsStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const job = await ctx.db
      .query("migrationJobs")
      .withIndex("by_key", (q) => q.eq("key", REQUIRED_USER_STATS_MIGRATION))
      .unique();
    if (!job) return { status: "missing" as const, phase: "missing", processed: 0 };
    return { status: job.status, phase: job.phase, processed: job.processed };
  },
});

export const resumeStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("migrationJobs")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "running").lt("updatedAt", now - MIGRATION_STALE_MS),
      )
      .take(10);
    for (const row of rows) {
      await ctx.db.patch(row._id, { updatedAt: now });
      if (row.key === REQUIRED_USER_STATS_MIGRATION) {
        await ctx.scheduler.runAfter(0, internal.migrations.stepUserStats, {});
      }
    }
    return { rescheduled: rows.length };
  },
});
