import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const WINDOW_MS = 60_000;

export const RATE_LIMITS = {
  post: 10,
  comment: 30,
  message: 40,
  friend_request: 20,
  block: 30,
  upload: 20,
  story: 12,
  report: 10,
  group: 8,
  event: 8,
} as const;

export async function takeRate(
  ctx: MutationCtx,
  userId: Id<"users">,
  action: keyof typeof RATE_LIMITS,
): Promise<void> {
  const limit = RATE_LIMITS[action];
  const now = Date.now();
  const rows = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action", (q) => q.eq("userId", userId).eq("action", action))
    .take(8);
  const keep = rows[0];
  for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
  if (!keep || now - keep.windowStart >= WINDOW_MS) {
    if (keep) {
      await ctx.db.patch(keep._id, { windowStart: now, count: 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        userId,
        action,
        windowStart: now,
        count: 1,
      });
    }
    return;
  }
  if (keep.count >= limit) {
    throw new Error("Too many attempts. Try again in a minute.");
  }
  await ctx.db.patch(keep._id, { count: keep.count + 1 });
}
