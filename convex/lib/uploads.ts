import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_VIDEO_BYTES = 32_000_000;

type StorageMeta = { contentType?: string; size?: number } | null;

async function metaOf(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<NonNullable<StorageMeta>> {
  const meta = await ctx.db.system.get(storageId);
  if (!meta) throw new Error("File not found");
  return meta as NonNullable<StorageMeta>;
}

export async function assertImage(
  ctx: MutationCtx,
  imageId: Id<"_storage">,
): Promise<void> {
  const meta = await metaOf(ctx, imageId);
  if (meta.contentType && !meta.contentType.startsWith("image/")) {
    throw new Error("File must be an image");
  }
  if (typeof meta.size === "number" && meta.size > MAX_IMAGE_BYTES) {
    throw new Error("Image too large (max 5 MB)");
  }
}

export async function assertVideo(
  ctx: MutationCtx,
  videoId: Id<"_storage">,
): Promise<void> {
  const meta = await metaOf(ctx, videoId);
  if (meta.contentType && !meta.contentType.startsWith("video/")) {
    throw new Error("File must be a video");
  }
  if (typeof meta.size === "number" && meta.size > MAX_VIDEO_BYTES) {
    throw new Error("Video too large (max 32 MB)");
  }
}

export async function registerOwnedUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<Id<"_storage">> {
  const existing = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (existing) {
    if (existing.userId !== userId) throw new Error("File not found");
    return storageId;
  }
  await ctx.db.insert("uploads", {
    storageId,
    userId,
    used: false,
    createdAt: Date.now(),
  });
  return storageId;
}

export async function claimUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<void> {
  const upload = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (!upload || upload.userId !== userId || upload.used) {
    throw new Error("File not found");
  }
  await ctx.db.patch(upload._id, { used: true });
}

export async function deleteOwnedUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<void> {
  const uploads = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .collect();
  for (const upload of uploads) {
    if (upload.userId === userId) await ctx.db.delete(upload._id);
  }
  await ctx.storage.delete(storageId).catch(() => undefined);
}
