import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { areFriends, friendshipForPair, hueFromString, profileOf } from "./lib/social";

// Public identity. `ensure` runs on every authenticated session boot so a
// profile row always exists before any other social mutation needs it.

export const ensure = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, { displayName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await profileOf(ctx, userId);
    const provided = displayName?.trim();
    if (existing) return existing._id; // renames go through profiles.update
    const user = await ctx.db.get(userId);
    const fallback = user?.email?.split("@")[0] ?? "Openbook user";
    return await ctx.db.insert("profiles", {
      userId,
      displayName: provided || user?.name || fallback,
      avatarHue: hueFromString(userId),
      coverHue: hueFromString([...userId].reverse().join("")),
      joinedAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await profileOf(ctx, userId);
    return profile ? { ...profile, isMe: true } : null;
  },
});

// A profile page payload: the profile plus the viewer's relationship to it,
// which drives the Add Friend / Respond / Friends button states.
export const view = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return null;
    const profile = await profileOf(ctx, userId);
    if (!profile) return null;
    let relationship:
      | "self"
      | "friends"
      | "outgoing_request"
      | "incoming_request"
      | "none" = "none";
    if (userId === viewerId) relationship = "self";
    else {
      const edge = await friendshipForPair(ctx, viewerId, userId);
      if (edge?.status === "accepted") relationship = "friends";
      else if (edge?.status === "pending")
        relationship =
          edge.requesterId === viewerId ? "outgoing_request" : "incoming_request";
    }
    return { ...profile, isMe: userId === viewerId, relationship };
  },
});

export const update = mutation({
  args: {
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    work: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await profileOf(ctx, userId);
    if (!profile) throw new Error("Profile missing — call profiles.ensure first");
    const patch: Record<string, string> = {};
    if (args.displayName !== undefined) {
      const name = args.displayName.trim();
      if (!name) throw new Error("Display name cannot be empty");
      if (name.length > 80) throw new Error("Display name too long (max 80)");
      patch.displayName = name;
    }
    for (const field of ["bio", "work", "location"] as const) {
      const value = args[field];
      if (value !== undefined) {
        if (value.length > 500) throw new Error(`${field} too long (max 500)`);
        patch[field] = value.trim();
      }
    }
    await ctx.db.patch(profile._id, patch);
  },
});

// Live people search over the full-text index, annotated with friendship state
// so result rows can render the right action.
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const viewerId = await getAuthUserId(ctx);
    if (!viewerId) return [];
    const term = q.trim();
    if (!term) return [];
    const hits = await ctx.db
      .query("profiles")
      .withSearchIndex("search_name", (s) => s.search("displayName", term))
      .take(8);
    return await Promise.all(
      hits.map(async (p) => ({
        userId: p.userId,
        displayName: p.displayName,
        avatarHue: p.avatarHue,
        isMe: p.userId === viewerId,
        isFriend: await areFriends(ctx, viewerId, p.userId),
      })),
    );
  },
});
