import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

describe("storage garbage collection", () => {
  it("sweeps unregistered storage across bounded pages and retains tracked files", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_800_000_000_000);
      const t = convexTest(schema, modules);
      const { orphanIds, trackedId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "gc@example.test" });
        const orphanIds = [];
        for (let index = 0; index < 45; index += 1) {
          orphanIds.push(await ctx.storage.store(new Blob([new Uint8Array([index])])));
        }
        const trackedId = await ctx.storage.store(new Blob([new Uint8Array([99])]));
        await ctx.db.insert("uploads", {
          storageId: trackedId,
          userId,
          used: true,
          size: 1,
          createdAt: Date.now(),
        });
        return { orphanIds, trackedId };
      });
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await t.mutation(internal.gc.orphanedStorage, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers, 20);
      await t.run(async (ctx) => {
        for (const storageId of orphanIds) expect(await ctx.storage.get(storageId)).toBeNull();
        expect(await ctx.storage.get(trackedId)).not.toBeNull();
        const cursor = await ctx.db
          .query("maintenanceCursors")
          .withIndex("by_key", (q) => q.eq("key", "orphaned-storage-v1"))
          .unique();
        expect(cursor?.cursor).toBeUndefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
