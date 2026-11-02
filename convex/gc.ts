import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordOpsState } from "./lib/ops";
import { deleteOwnedUpload } from "./lib/uploads";

const ORPHAN_MS = 15 * 60 * 1000;
const STORAGE_SWEEP_KEY = "orphaned-storage-v1";
const STORAGE_SWEEP_BATCH = 40;

export const unusedUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("uploads")
      .withIndex("by_used_created", (q) => q.eq("used", false))
      .order("asc")
      .take(40);
    const now = Date.now();
    let deleted = 0;
    for (const row of rows) {
      if (now - row.createdAt < ORPHAN_MS) continue;
      await deleteOwnedUpload(ctx, row.userId, row.storageId);
      deleted += 1;
    }
    await recordOpsState(ctx, "unused-upload-gc", "ok", `deleted=${deleted}`);
    const hasMore = rows.length === 40 && deleted === 40;
    if (hasMore) await ctx.scheduler.runAfter(0, internal.gc.unusedUploads, {});
    return { deleted, hasMore };
  },
});

export const orphanedStorage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const state = await ctx.db
      .query("maintenanceCursors")
      .withIndex("by_key", (q) => q.eq("key", STORAGE_SWEEP_KEY))
      .unique();
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({ numItems: STORAGE_SWEEP_BATCH, cursor: state?.cursor ?? null });
    let deleted = 0;
    for (const file of page.page) {
      if (now - file._creationTime < ORPHAN_MS) continue;
      const tracked = await ctx.db
        .query("uploads")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (tracked) continue;
      await ctx.storage.delete(file._id).catch(() => undefined);
      deleted += 1;
    }
    const cursor = page.isDone ? undefined : page.continueCursor;
    if (state) {
      await ctx.db.patch(state._id, { cursor, updatedAt: now });
    } else {
      await ctx.db.insert("maintenanceCursors", {
        key: STORAGE_SWEEP_KEY,
        cursor,
        updatedAt: now,
      });
    }
    await recordOpsState(
      ctx,
      "storage-orphan-gc",
      "ok",
      `deleted=${deleted} sweepComplete=${page.isDone}`,
    );
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.gc.orphanedStorage, {});
    return { deleted, sweepComplete: page.isDone };
  },
});

export const expiredStories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("stories").withIndex("by_expires").order("asc").take(40);
    let deleted = 0;
    for (const row of rows) {
      if (row.expiresAt > now) break;
      if (row.imageId) {
        await deleteOwnedUpload(ctx, row.authorId, row.imageId);
      }
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    await recordOpsState(ctx, "expired-story-gc", "ok", `deleted=${deleted}`);
    const hasMore = rows.length === 40 && deleted === 40;
    if (hasMore) await ctx.scheduler.runAfter(0, internal.gc.expiredStories, {});
    return { deleted, hasMore };
  },
});
