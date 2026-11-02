import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const read = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("opsState").take(10);
    return { documents: rows.length };
  },
});

export const write = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(nonce)) throw new Error("Invalid load nonce");
    const id = await ctx.db.insert("loadProbeSamples", { nonce, createdAt: Date.now() });
    await ctx.db.delete(id);
    return { committed: true };
  },
});
