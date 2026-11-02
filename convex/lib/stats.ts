import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { MAX_PAIR_ROWS } from "./limits";

type CounterName =
  | "postCount"
  | "notificationUnreadCount"
  | "messageUnreadCount"
  | "friendCount"
  | "storageBytes"
  | "uploadCount";

function emptyStats(userId: Id<"users">, exact: boolean) {
  return {
    userId,
    postCount: 0,
    notificationUnreadCount: 0,
    messageUnreadCount: 0,
    friendCount: 0,
    storageBytes: 0,
    uploadCount: 0,
    postCountExact: exact,
    notificationUnreadCountExact: exact,
    messageUnreadCountExact: exact,
    friendCountExact: exact,
    storageBytesExact: exact,
    uploadCountExact: exact,
    updatedAt: Date.now(),
  };
}

export async function userStats(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"userStats"> | null> {
  const rows = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_PAIR_ROWS);
  return rows[0] ?? null;
}

export async function ensureUserStats(
  ctx: MutationCtx,
  userId: Id<"users">,
  exactForNew = false,
): Promise<Doc<"userStats">> {
  const rows = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_PAIR_ROWS);
  const keep = rows[0];
  if (keep) {
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    return keep;
  }
  const id = await ctx.db.insert("userStats", emptyStats(userId, exactForNew));
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Could not create user statistics");
  return created;
}

export async function adjustUserStat(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: CounterName,
  delta: number,
): Promise<number> {
  const stats = await ensureUserStats(ctx, userId);
  const next = Math.max(0, (stats[name] ?? 0) + delta);
  await ctx.db.patch(stats._id, { [name]: next, updatedAt: Date.now() });
  return next;
}

export async function setUserStat(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: CounterName,
  value: number,
  exact = false,
): Promise<void> {
  const stats = await ensureUserStats(ctx, userId);
  const exactField = `${name}Exact` as
    | "postCountExact"
    | "notificationUnreadCountExact"
    | "messageUnreadCountExact"
    | "friendCountExact"
    | "storageBytesExact"
    | "uploadCountExact";
  await ctx.db.patch(stats._id, {
    [name]: Math.max(0, value),
    ...(exact ? { [exactField]: true } : {}),
    updatedAt: Date.now(),
  });
}
