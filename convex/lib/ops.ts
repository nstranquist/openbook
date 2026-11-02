import type { MutationCtx } from "../_generated/server";
import { runtimeMetadata } from "./runtime";

export async function recordOpsState(
  ctx: MutationCtx,
  key: string,
  status: "ok" | "error",
  detail?: string,
): Promise<void> {
  const existing = await ctx.db
    .query("opsState")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const value = {
    key,
    status,
    updatedAt: Date.now(),
    release: runtimeMetadata().release,
    detail: detail?.slice(0, 240),
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("opsState", value);
}
