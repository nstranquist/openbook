import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordOpsState } from "./lib/ops";
import { adjustUserStat } from "./lib/stats";
import { UPLOAD_GRANT_TTL_MS } from "./lib/limits";

const BATCH_SIZE = 100;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const TYPING_RETENTION_MS = 10 * 60 * 1000;
const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DELIVERY_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STRIPE_RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLIENT_ERROR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_DELETION_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const pruneEphemeral = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [rates, typing, notifications, deliveries, canceledDeliveries, stripeReceipts, clientErrors, clientRates, deletionReceipts, uploadGrants] = await Promise.all([
      ctx.db
        .query("rateLimits")
        .withIndex("by_window", (q) => q.lt("windowStart", now - RATE_LIMIT_RETENTION_MS))
        .take(BATCH_SIZE),
      ctx.db
        .query("conversationTyping")
        .withIndex("by_updated", (q) => q.lt("updatedAt", now - TYPING_RETENTION_MS))
        .take(BATCH_SIZE),
      ctx.db
        .query("notifications")
        .withIndex("by_created", (q) => q.lt("createdAt", now - NOTIFICATION_RETENTION_MS))
        .take(BATCH_SIZE),
      ctx.db
        .query("deliveryJobs")
        .withIndex("by_state_next", (q) =>
          q.eq("state", "succeeded").lt("nextAttemptAt", now - DELIVERY_RECEIPT_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("deliveryJobs")
        .withIndex("by_state_next", (q) =>
          q.eq("state", "canceled").lt("nextAttemptAt", now - DELIVERY_RECEIPT_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("stripeWebhookEvents")
        .withIndex("by_received", (q) =>
          q.lt("receivedAt", now - STRIPE_RECEIPT_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("clientErrors")
        .withIndex("by_created", (q) =>
          q.lt("createdAt", now - CLIENT_ERROR_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("clientErrorRateLimits")
        .withIndex("by_window", (q) =>
          q.lt("windowStart", now - RATE_LIMIT_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_completed_updated", (q) =>
          q.gt("completedAt", 0).lt("completedAt", now - ACCOUNT_DELETION_RECEIPT_RETENTION_MS),
        )
        .take(BATCH_SIZE),
      ctx.db
        .query("uploadGrants")
        .withIndex("by_created", (q) => q.lt("createdAt", now - 2 * UPLOAD_GRANT_TTL_MS))
        .take(BATCH_SIZE),
    ]);
    for (const row of rates) await ctx.db.delete(row._id);
    for (const row of typing) await ctx.db.delete(row._id);
    const unreadByUser = new Map<string, { userId: typeof notifications[number]["userId"]; count: number }>();
    for (const row of notifications) {
      if (!row.read) {
        const current = unreadByUser.get(row.userId);
        unreadByUser.set(row.userId, { userId: row.userId, count: (current?.count ?? 0) + 1 });
      }
      await ctx.db.delete(row._id);
    }
    for (const { userId, count } of unreadByUser.values()) {
      await adjustUserStat(ctx, userId, "notificationUnreadCount", -count);
    }
    for (const row of deliveries) await ctx.db.delete(row._id);
    for (const row of canceledDeliveries) await ctx.db.delete(row._id);
    for (const row of stripeReceipts) await ctx.db.delete(row._id);
    for (const row of clientErrors) await ctx.db.delete(row._id);
    for (const row of clientRates) await ctx.db.delete(row._id);
    for (const row of deletionReceipts) await ctx.db.delete(row._id);
    for (const row of uploadGrants) await ctx.db.delete(row._id);
    const deleted =
      rates.length + typing.length + notifications.length + deliveries.length + canceledDeliveries.length +
      stripeReceipts.length + clientErrors.length + clientRates.length + deletionReceipts.length + uploadGrants.length;
    await recordOpsState(ctx, "ephemeral-maintenance", "ok", `deleted=${deleted}`);
    const hasMore = [rates, typing, notifications, deliveries, canceledDeliveries, stripeReceipts, clientErrors, clientRates, deletionReceipts, uploadGrants].some(
      (rows) => rows.length === BATCH_SIZE,
    );
    if (hasMore) await ctx.scheduler.runAfter(0, internal.maintenance.pruneEphemeral, {});
    return { deleted, hasMore };
  },
});
