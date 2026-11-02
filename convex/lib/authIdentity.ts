import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_PAIR_ROWS } from "./limits";

type AuthCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

export function configuredAuthMode(): "convex-auth" | "clerk" {
  if (process.env.OPENBOOK_AUTH_MODE === "clerk") return "clerk";
  if (process.env.OPENBOOK_ENV === "production") {
    throw new Error("Production authentication requires Clerk");
  }
  return "convex-auth";
}

export async function currentUserId(ctx: AuthCtx): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (configuredAuthMode() === "convex-auth") {
    return await getAuthUserId(ctx);
  }
  const rows = await ctx.db
    .query("externalIdentities")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .take(MAX_PAIR_ROWS);
  return rows[0]?.userId ?? null;
}

export async function provisionCurrentUser(ctx: MutationCtx): Promise<Id<"users">> {
  const existing = await currentUserId(ctx);
  if (existing) return existing;
  if (configuredAuthMode() !== "clerk") throw new Error("Not authenticated");
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const expectedIssuer = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "").replace(/\/$/, "");
  if (!expectedIssuer || identity.issuer.replace(/\/$/, "") !== expectedIssuer) {
    throw new Error("Authentication issuer is not configured");
  }
  const providerUserId = identity.subject.trim();
  if (!providerUserId || providerUserId.length > 255 || identity.tokenIdentifier.length > 1_024) {
    throw new Error("Invalid authentication identity");
  }
  const prior = await ctx.db
    .query("externalIdentities")
    .withIndex("by_provider_user", (q) =>
      q.eq("provider", "clerk").eq("providerUserId", providerUserId),
    )
    .take(MAX_PAIR_ROWS);
  if (prior[0]) {
    if (prior[0].tokenIdentifier !== identity.tokenIdentifier) {
      await ctx.db.patch(prior[0]._id, { tokenIdentifier: identity.tokenIdentifier });
    }
    return prior[0].userId;
  }
  const email = typeof identity.email === "string" ? identity.email.slice(0, 320) : undefined;
  const name = typeof identity.name === "string" ? identity.name.slice(0, 160) : undefined;
  const image = typeof identity.pictureUrl === "string" ? identity.pictureUrl.slice(0, 2_048) : undefined;
  const userId = await ctx.db.insert("users", { email, name, image });
  await ctx.db.insert("externalIdentities", {
    provider: "clerk",
    tokenIdentifier: identity.tokenIdentifier,
    providerUserId,
    userId,
    createdAt: Date.now(),
  });
  return userId;
}
