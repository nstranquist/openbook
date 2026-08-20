import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const WINDOW_MS = 60_000;

export const RATE_LIMITS = {
  post: 10,
  comment: 30,
  message: 40,
  friend_request: 20,
  block: 30,
} as const;

export async function takeRate(
  ctx: MutationCtx,
  userId: Id<"users">,
  action: keyof typeof RATE_LIMITS,
): Promise<void> {
  const limit = RATE_LIMITS[action];
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_user_action", (q) => q.eq("userId", userId).eq("action", action))
    .unique();
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    if (existing) {
      await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
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
  if (existing.count >= limit) {
    throw new Error("Too many attempts. Try again in a minute.");
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
