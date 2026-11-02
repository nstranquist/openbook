import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  isBlockedEitherWay,
  requireActiveProfile,
  requireActiveUser,
} from "./lib/social";
import { signedMediaUrl } from "./lib/mediaSign";
import { assertImage, claimUpload } from "./lib/uploads";
import { MAX_ALBUMS_PER_USER, MAX_PHOTOS_PER_ALBUM } from "./lib/limits";
import { takeRate } from "./lib/rate";
import { boundedPaginationOptions } from "./lib/pagination";

async function albumCard(ctx: QueryCtx, album: Doc<"albums">) {
  const coverImageIds = album.coverImageIds ?? (
    await ctx.db
      .query("albumItems")
      .withIndex("by_album", (q) => q.eq("albumId", album._id))
      .order("desc")
      .take(4)
  ).map((item) => item.imageId);
  const urls = await Promise.all(
    coverImageIds.map(async (imageId) => (await signedMediaUrl(imageId)) ?? null),
  );
  return {
    ...album,
    itemCount: album.itemCount ?? coverImageIds.length,
    coverUrls: urls.filter((url): url is string => !!url),
  };
}

export const listMine = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireActiveUser(ctx);
    await requireActiveProfile(ctx, userId);
    if (await isBlockedEitherWay(ctx, me, userId)) return [];
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(MAX_ALBUMS_PER_USER);
    albums.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(albums.map((album) => albumCard(ctx, album)));
  },
});

export const listPage = query({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { userId, paginationOpts }) => {
    const me = await requireActiveUser(ctx);
    await requireActiveProfile(ctx, userId);
    if (await isBlockedEitherWay(ctx, me, userId)) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("albums")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .paginate(boundedPaginationOptions(paginationOpts));
    return { ...result, page: await Promise.all(result.page.map((album) => albumCard(ctx, album))) };
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const me = await requireActiveUser(ctx);
    await takeRate(ctx, me, "album");
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title required");
    if (trimmed.length > 80) throw new Error("Title too long");
    const mine = await ctx.db
      .query("albums")
      .withIndex("by_owner", (q) => q.eq("ownerId", me))
      .take(MAX_ALBUMS_PER_USER);
    if (mine.length >= MAX_ALBUMS_PER_USER) {
      throw new Error(`Album limit reached (${MAX_ALBUMS_PER_USER})`);
    }
    return await ctx.db.insert("albums", {
      ownerId: me,
      title: trimmed,
      createdAt: Date.now(),
      itemCount: 0,
      coverImageIds: [],
    });
  },
});

export const addPhoto = mutation({
  args: { albumId: v.id("albums"), imageId: v.id("_storage") },
  handler: async (ctx, { albumId, imageId }) => {
    const me = await requireActiveUser(ctx);
    await takeRate(ctx, me, "album");
    const album = await ctx.db.get(albumId);
    if (!album || album.ownerId !== me) throw new Error("Album not found");
    const existingCount = album.itemCount ?? (
      await ctx.db
        .query("albumItems")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .take(MAX_PHOTOS_PER_ALBUM)
    ).length;
    if (existingCount >= MAX_PHOTOS_PER_ALBUM) {
      throw new Error(`Album photo limit reached (${MAX_PHOTOS_PER_ALBUM})`);
    }
    await assertImage(ctx, imageId);
    await claimUpload(ctx, me, imageId);
    const itemId = await ctx.db.insert("albumItems", {
      albumId,
      imageId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(albumId, {
      itemCount: existingCount + 1,
      coverImageIds: [imageId, ...(album.coverImageIds ?? [])].slice(0, 4),
    });
    return itemId;
  },
});
