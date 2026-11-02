import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import { maintenanceIsReady, opsStateIsReady } from "./health";
import { REQUIRED_USER_STATS_MIGRATION } from "./lib/limits";
import schema from "./schema";
import { modules } from "./test.setup";

describe("health readiness", () => {
  it("requires a recent scheduler heartbeat", () => {
    const now = 2_000_000;
    expect(maintenanceIsReady(null, now)).toBe(false);
    expect(maintenanceIsReady(now - 60_000, now)).toBe(true);
    expect(maintenanceIsReady(now - 21 * 60_000, now)).toBe(false);
    expect(maintenanceIsReady(now + 1, now)).toBe(false);
    expect(opsStateIsReady("ok", now - 44 * 60_000, now)).toBe(true);
    expect(opsStateIsReady("error", now, now)).toBe(false);
    expect(opsStateIsReady("ok", now - 46 * 60_000, now)).toBe(false);
  });

  it("requires the current counter and storage migration", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const key of [
        "scheduler",
        "delivery",
        "unused-upload-gc",
        "storage-orphan-gc",
        "expired-story-gc",
        "ephemeral-maintenance",
      ]) {
        await ctx.db.insert("opsState", {
          key,
          status: "ok",
          updatedAt: now,
          release: "test",
        });
      }
      await ctx.db.insert("migrationJobs", {
        key: "user-stats-v2",
        phase: "complete",
        status: "complete",
        processed: 1,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
      });
    });

    expect(await t.query(internal.health.readiness, { now })).toMatchObject({
      ok: false,
      migrations: false,
      requiredMigration: "missing",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("migrationJobs", {
        key: REQUIRED_USER_STATS_MIGRATION,
        phase: "complete",
        status: "complete",
        processed: 1,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
      });
    });

    expect(await t.query(internal.health.readiness, { now })).toMatchObject({
      ok: true,
      migrations: true,
      requiredMigration: "complete",
    });
  });

  it("fails when an individual maintenance loop is stale", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    for (const key of [
      "scheduler",
      "delivery",
      "unused-upload-gc",
      "storage-orphan-gc",
      "expired-story-gc",
      "ephemeral-maintenance",
    ]) {
      await t.run(async (ctx) => {
        await ctx.db.insert("opsState", {
          key,
          status: "ok",
          updatedAt: key === "storage-orphan-gc" ? now - 46 * 60_000 : now,
          release: "test",
        });
      });
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationJobs", {
        key: REQUIRED_USER_STATS_MIGRATION,
        phase: "complete",
        status: "complete",
        processed: 0,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
      });
    });

    expect(await t.query(internal.health.readiness, { now })).toMatchObject({
      ok: false,
      maintenance: false,
      staleMaintenanceJobs: ["storage-orphan-gc"],
    });
  });
});
