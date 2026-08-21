import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActiveUser } from "./lib/social";
import { signedMediaUrl } from "./lib/mediaSign";
import { assertImage, claimUpload } from "./lib/uploads";

export const listMine = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireActiveUser(ctx);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    albums.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      albums.map(async (album) => {
        const items = await ctx.db
          .query("albumItems")
          .withIndex("by_album", (q) => q.eq("albumId", album._id))
          .collect();
        items.sort((a, b) => b.createdAt - a.createdAt);
        const urls = await Promise.all(
          items.slice(0, 4).map(async (item) => (await signedMediaUrl(item.imageId)) ?? null),
        );
        return {
          ...album,
          itemCount: items.length,
          coverUrls: urls.filter((u): u is string => !!u),
        };
      }),
    );
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const me = await requireActiveUser(ctx);
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title required");
    if (trimmed.length > 80) throw new Error("Title too long");
    return await ctx.db.insert("albums", {
      ownerId: me,
      title: trimmed,
      createdAt: Date.now(),
    });
  },
});

export const addPhoto = mutation({
  args: { albumId: v.id("albums"), imageId: v.id("_storage") },
  handler: async (ctx, { albumId, imageId }) => {
    const me = await requireActiveUser(ctx);
    const album = await ctx.db.get(albumId);
    if (!album || album.ownerId !== me) throw new Error("Album not found");
    await assertImage(ctx, imageId);
    await claimUpload(ctx, me, imageId);
    return await ctx.db.insert("albumItems", {
      albumId,
      imageId,
      createdAt: Date.now(),
    });
  },
});
