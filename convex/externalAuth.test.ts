import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { modules } from "./test.setup";

const previousMode = process.env.OPENBOOK_AUTH_MODE;
const previousIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
const previousResend = process.env.RESEND_API_KEY;

beforeEach(() => {
  process.env.OPENBOOK_AUTH_MODE = "clerk";
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.openbook.test";
  process.env.RESEND_API_KEY = "re_test";
});

afterEach(() => {
  if (previousMode === undefined) delete process.env.OPENBOOK_AUTH_MODE;
  else process.env.OPENBOOK_AUTH_MODE = previousMode;
  if (previousIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  else process.env.CLERK_JWT_ISSUER_DOMAIN = previousIssuer;
  if (previousResend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResend;
});

describe("stable production identity mapping", () => {
  it("provisions one internal user for a validated Clerk identity", async () => {
    const t = convexTest(schema, modules);
    const asClerk = t.withIdentity({
      issuer: "https://clerk.openbook.test",
      subject: "user_clerk_1",
      email: "alice@example.test",
      name: "Alice Clerk",
    });
    const first = await asClerk.mutation(api.profiles.ensure, {});
    const second = await asClerk.mutation(api.profiles.ensure, {});
    expect(second).toBe(first);
    const me = await asClerk.query(api.profiles.me, {});
    expect(me).toMatchObject({ displayName: "Alice Clerk", email: "alice@example.test" });
    await expect(
      asClerk.mutation(api.posts.create, { body: "Clerk can write", audience: "public" }),
    ).resolves.toBeTypeOf("string");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("externalIdentities").collect()).toHaveLength(1);
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
    });
  });

  it("rejects an identity from an unexpected issuer", async () => {
    const t = convexTest(schema, modules);
    const wrong = t.withIdentity({
      issuer: "https://attacker.example.test",
      subject: "user_wrong",
    });
    await expect(wrong.mutation(api.profiles.ensure, {})).rejects.toThrow(/issuer/i);
  });

  it("removes the provider mapping only after provider deletion succeeds", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      await ctx.db.insert("externalIdentities", {
        provider: "clerk",
        tokenIdentifier: "https://clerk.openbook.test|user_deleted",
        providerUserId: "user_deleted",
        userId,
        createdAt: Date.now(),
      });
    });
    expect(await t.mutation(internal.externalAuth.completeClerkDeletion, {
      clerkUserId: "user_deleted",
    })).toEqual({ deleted: 1 });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("externalIdentities").collect()).toEqual([]);
    });
  });

  it("keeps account erasure open until durable Clerk deletion finishes", async () => {
    const t = convexTest(schema, modules);
    const asClerk = t.withIdentity({
      issuer: "https://clerk.openbook.test",
      subject: "user_erase",
      email: "erase@example.test",
      name: "Erase Me",
    });
    await asClerk.mutation(api.profiles.ensure, {});
    await asClerk.mutation(api.profiles.deleteAccount, {});
    const userId = await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("externalIdentities")
        .withIndex("by_provider_user", (q) =>
          q.eq("provider", "clerk").eq("providerUserId", "user_erase"),
        )
        .unique();
      if (!identity) throw new Error("identity missing");
      return identity.userId;
    });
    for (let step = 0; step < 4; step += 1) {
      await t.mutation(internal.profiles.deleteAccountBatch, { userId });
    }
    await t.run(async (ctx) => {
      const job = await ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      const providerJob = await ctx.db
        .query("deliveryJobs")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", "clerk-delete:user_erase"))
        .unique();
      expect(job?.phase).toBe("external_identity");
      expect(job?.completedAt).toBeUndefined();
      expect(providerJob?.payload).toEqual({ kind: "clerk_delete", clerkUserId: "user_erase" });
    });

    await t.mutation(internal.externalAuth.completeClerkDeletion, { clerkUserId: "user_erase" });
    await t.mutation(internal.profiles.deleteAccountBatch, { userId });
    await t.run(async (ctx) => {
      const job = await ctx.db
        .query("accountDeletionJobs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(job?.phase).toBe("messages");
    });
  });
});
