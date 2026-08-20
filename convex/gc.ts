import { internalMutation } from "./_generated/server";

const ORPHAN_MS = 60 * 60 * 1000;

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
      await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
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
        const upload = await ctx.db
          .query("uploads")
          .withIndex("by_storage", (q) => q.eq("storageId", row.imageId!))
          .first();
        if (upload) await ctx.db.delete(upload._id);
        await ctx.storage.delete(row.imageId).catch(() => undefined);
      }
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});
