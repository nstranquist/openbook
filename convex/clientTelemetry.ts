import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 20;

export const ingest = internalMutation({
  args: {
    sourceHash: v.string(),
    fingerprint: v.string(),
    kind: v.union(v.literal("error"), v.literal("unhandledrejection")),
    message: v.string(),
    stack: v.optional(v.string()),
    route: v.string(),
    release: v.string(),
    environment: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash)) throw new Error("Invalid source hash");
    if (!/^[a-f0-9]{16,64}$/.test(args.fingerprint)) throw new Error("Invalid fingerprint");
    if (!args.message.trim() || args.message.length > 500 || (args.stack?.length ?? 0) > 2_000) {
      throw new Error("Invalid error report");
    }
    if (args.route.length > 500 || args.release.length > 128 || args.environment.length > 32) {
      throw new Error("Invalid error metadata");
    }
    const now = Date.now();
    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const rate = await ctx.db
      .query("clientErrorRateLimits")
      .withIndex("by_source_window", (q) =>
        q.eq("sourceHash", args.sourceHash).eq("windowStart", windowStart),
      )
      .unique();
    if (rate?.count && rate.count >= LIMIT_PER_WINDOW) throw new Error("Rate limit exceeded");
    if (rate) await ctx.db.patch(rate._id, { count: rate.count + 1 });
    else await ctx.db.insert("clientErrorRateLimits", { sourceHash: args.sourceHash, windowStart, count: 1 });
    return await ctx.db.insert("clientErrors", {
      fingerprint: args.fingerprint,
      kind: args.kind,
      message: args.message.trim(),
      stack: args.stack,
      route: args.route,
      release: args.release,
      environment: args.environment,
      createdAt: now,
    });
  },
});

export const summary = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db
      .query("clientErrors")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .take(100);
    const fingerprints = new Map<string, number>();
    for (const row of rows) {
      fingerprints.set(row.fingerprint, (fingerprints.get(row.fingerprint) ?? 0) + 1);
    }
    return {
      sampled: rows.length,
      truncated: rows.length === 100,
      groups: [...fingerprints.entries()]
        .map(([fingerprint, count]) => ({ fingerprint, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    };
  },
});
