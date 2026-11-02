import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { recordOpsState } from "./lib/ops";
import { runtimeMetadata } from "./lib/runtime";
import { ACCOUNT_DELETION_STALE_MS, REQUIRED_USER_STATS_MIGRATION } from "./lib/limits";

const SCHEDULER_STALE_MS = 20 * 60 * 1000;
const MAINTENANCE_STALE_MS = 45 * 60 * 1000;
const REQUIRED_MAINTENANCE_KEYS = [
  "unused-upload-gc",
  "storage-orphan-gc",
  "expired-story-gc",
  "ephemeral-maintenance",
] as const;

export function maintenanceIsReady(updatedAt: number | null, now: number): boolean {
  return updatedAt !== null && now >= updatedAt && now - updatedAt <= SCHEDULER_STALE_MS;
}

export function opsStateIsReady(
  status: "ok" | "error" | null,
  updatedAt: number | null,
  now: number,
  maximumAge = MAINTENANCE_STALE_MS,
): boolean {
  return (
    status === "ok" &&
    updatedAt !== null &&
    now >= updatedAt &&
    now - updatedAt <= maximumAge
  );
}

export const heartbeat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await recordOpsState(ctx, "scheduler", "ok", "cron heartbeat");
    return null;
  },
});

export const readiness = internalQuery({
  args: { now: v.number() },
  returns: v.object({
    ok: v.boolean(),
    database: v.boolean(),
    maintenance: v.boolean(),
    delivery: v.boolean(),
    accountDeletion: v.boolean(),
    migrations: v.boolean(),
    configuration: v.boolean(),
    maintenanceUpdatedAt: v.union(v.number(), v.null()),
    deliveryUpdatedAt: v.union(v.number(), v.null()),
    staleMaintenanceJobs: v.array(v.string()),
    configurationIssues: v.array(v.string()),
    deadDeliveries: v.number(),
    overdueDeliveries: v.number(),
    staleAccountDeletions: v.number(),
    requiredMigration: v.union(v.literal("missing"), v.literal("running"), v.literal("complete")),
  }),
  handler: async (ctx, { now }) => {
    // A bounded read proves that the database is available without scanning data.
    await ctx.db.query("profiles").take(1);
    const metadata = runtimeMetadata();
    const [
      heartbeat,
      deliveryHeartbeat,
      maintenanceRows,
      deadDeliveries,
      overdueDeliveries,
      staleAccountDeletions,
      userStatsMigration,
    ] = await Promise.all([
      ctx.db
        .query("opsState")
        .withIndex("by_key", (q) => q.eq("key", "scheduler"))
        .unique(),
      ctx.db
        .query("opsState")
        .withIndex("by_key", (q) => q.eq("key", "delivery"))
        .unique(),
      Promise.all(
        REQUIRED_MAINTENANCE_KEYS.map(async (key) =>
          await ctx.db.query("opsState").withIndex("by_key", (q) => q.eq("key", key)).unique(),
        ),
      ),
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
      ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_completed_updated", (q) =>
          q.eq("completedAt", undefined).lt("updatedAt", now - ACCOUNT_DELETION_STALE_MS),
        )
        .take(1),
      ctx.db
        .query("migrationJobs")
        .withIndex("by_key", (q) => q.eq("key", REQUIRED_USER_STATS_MIGRATION))
        .unique(),
    ]);
    const staleMaintenanceJobs = REQUIRED_MAINTENANCE_KEYS.filter(
      (_, index) =>
        !opsStateIsReady(
          maintenanceRows[index]?.status ?? null,
          maintenanceRows[index]?.updatedAt ?? null,
          now,
        ),
    );
    const maintenance =
      maintenanceIsReady(heartbeat?.updatedAt ?? null, now) && staleMaintenanceJobs.length === 0;
    const delivery =
      opsStateIsReady(
        deliveryHeartbeat?.status ?? null,
        deliveryHeartbeat?.updatedAt ?? null,
        now,
        SCHEDULER_STALE_MS,
      ) &&
      deadDeliveries.length === 0 &&
      overdueDeliveries.length === 0;
    const accountDeletion = staleAccountDeletions.length === 0;
    const requiredMigration: "missing" | "running" | "complete" =
      userStatsMigration?.status ?? "missing";
    const migrations = requiredMigration === "complete";
    const configuration = metadata.configurationIssues.length === 0;
    return {
      ok: maintenance && configuration && delivery && accountDeletion && migrations,
      database: true,
      maintenance,
      delivery,
      accountDeletion,
      migrations,
      configuration,
      maintenanceUpdatedAt: heartbeat?.updatedAt ?? null,
      deliveryUpdatedAt: deliveryHeartbeat?.updatedAt ?? null,
      staleMaintenanceJobs,
      configurationIssues: metadata.configurationIssues,
      deadDeliveries: deadDeliveries.length,
      overdueDeliveries: overdueDeliveries.length,
      staleAccountDeletions: staleAccountDeletions.length,
      requiredMigration,
    };
  },
});
