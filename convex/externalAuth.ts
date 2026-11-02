import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { MAX_PAIR_ROWS } from "./lib/limits";

export const completeClerkDeletion = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const rows = await ctx.db
      .query("externalIdentities")
      .withIndex("by_provider_user", (q) =>
        q.eq("provider", "clerk").eq("providerUserId", clerkUserId),
      )
      .take(MAX_PAIR_ROWS);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});
