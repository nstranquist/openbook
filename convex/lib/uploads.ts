import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  MAX_ACTIVE_UPLOAD_GRANTS,
  MAX_MEDIA_RESPONSE_BYTES,
  MAX_PAIR_ROWS,
  UPLOAD_GRANT_TTL_MS,
} from "./limits";
import {
  assertAdditionWithinLimit,
  assertWithinLimit,
  effectivePlan,
  planLimits,
} from "./plans";
import { ensureUserStats, userStats } from "./stats";

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_VIDEO_BYTES = MAX_MEDIA_RESPONSE_BYTES;

type StorageMeta = { contentType?: string; size?: number } | null;
const IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export type UploadKind = "image" | "video";

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
  assertImageMetadata(meta);
}

export function assertImageMetadata(meta: NonNullable<StorageMeta>): void {
  if (!meta.contentType || !IMAGE_TYPES.has(meta.contentType.toLowerCase())) {
    throw new Error("File must be an image");
  }
  if (typeof meta.size !== "number" || meta.size <= 0) throw new Error("Image is empty");
  if (meta.size > MAX_IMAGE_BYTES) {
    throw new Error("Image too large (max 5 MB)");
  }
}

export async function assertVideo(
  ctx: MutationCtx,
  videoId: Id<"_storage">,
): Promise<void> {
  const meta = await metaOf(ctx, videoId);
  assertVideoMetadata(meta);
}

export function assertVideoMetadata(meta: NonNullable<StorageMeta>): void {
  if (!meta.contentType || !VIDEO_TYPES.has(meta.contentType.toLowerCase())) {
    throw new Error("File must be a video");
  }
  if (typeof meta.size !== "number" || meta.size <= 0) throw new Error("Video is empty");
  if (meta.size > MAX_VIDEO_BYTES) {
    throw new Error("Video too large (max 19 MB)");
  }
}

function validateDeclaredUpload(kind: UploadKind, declaredBytes: number): void {
  const maximum = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > maximum) {
    throw new Error(`Invalid ${kind} upload size`);
  }
}

export async function generateGrantedUploadUrl(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: UploadKind,
  declaredBytes: number,
) {
  validateDeclaredUpload(kind, declaredBytes);
  const now = Date.now();
  const active = await ctx.db
    .query("uploadGrants")
    .withIndex("by_user_active_created", (q) =>
      q.eq("userId", userId).eq("active", true).gte("createdAt", now - UPLOAD_GRANT_TTL_MS),
    )
    .take(MAX_ACTIVE_UPLOAD_GRANTS);
  if (active.length >= MAX_ACTIVE_UPLOAD_GRANTS) {
    throw new Error("Too many active uploads. Finish or wait for an upload to expire.");
  }
  const stats = await ensureUserStats(ctx, userId);
  if (stats.storageBytesExact !== true || stats.uploadCountExact !== true) {
    throw new Error("Storage migration is not complete");
  }
  const plan = await effectivePlan(ctx, userId);
  const limits = planLimits(plan);
  const reservedBytes = active.reduce((sum, grant) => sum + grant.declaredBytes, 0);
  assertAdditionWithinLimit(
    "storage bytes",
    (stats.storageBytes ?? 0) + reservedBytes,
    declaredBytes,
    limits.storageBytes,
    plan,
  );
  assertWithinLimit(
    "uploaded files",
    (stats.uploadCount ?? 0) + active.length,
    limits.uploads,
    plan,
  );
  const grantId = await ctx.db.insert("uploadGrants", {
    userId,
    kind,
    declaredBytes,
    active: true,
    createdAt: now,
  });
  return { uploadUrl: await ctx.storage.generateUploadUrl(), grantId };
}

export async function registerGrantedUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
  grantId: Id<"uploadGrants">,
  storageId: Id<"_storage">,
  kind: UploadKind,
): Promise<Id<"_storage">> {
  const grant = await ctx.db.get(grantId);
  if (!grant || grant.userId !== userId || grant.kind !== kind) {
    throw new Error("Upload grant not found");
  }
  if (!grant.active) {
    if (grant.storageId === storageId) return storageId;
    throw new Error("Upload grant already used");
  }
  if (Date.now() - grant.createdAt > UPLOAD_GRANT_TTL_MS) {
    throw new Error("Upload grant expired");
  }
  const meta = await metaOf(ctx, storageId);
  if (meta.size !== grant.declaredBytes) {
    throw new Error("Uploaded file size does not match its grant");
  }
  if (kind === "image") assertImageMetadata(meta);
  else assertVideoMetadata(meta);
  await registerOwnedUpload(ctx, userId, storageId);
  await ctx.db.patch(grantId, {
    active: false,
    storageId,
    consumedAt: Date.now(),
  });
  return storageId;
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
  const meta = await metaOf(ctx, storageId);
  if (typeof meta.size !== "number" || meta.size <= 0) throw new Error("File is empty");
  await reserveStorage(ctx, userId, meta.size);
  await ctx.db.insert("uploads", {
    storageId,
    userId,
    used: false,
    size: meta.size,
    createdAt: Date.now(),
  });
  return storageId;
}

export async function registerClaimedUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<void> {
  const existing = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (existing) {
    if (existing.userId !== userId) throw new Error("File not found");
    if (!existing.used) await ctx.db.patch(existing._id, { used: true });
    return;
  }
  const meta = await metaOf(ctx, storageId);
  if (typeof meta.size !== "number" || meta.size <= 0) throw new Error("File is empty");
  await reserveStorage(ctx, userId, meta.size);
  await ctx.db.insert("uploads", {
    storageId,
    userId,
    used: true,
    size: meta.size,
    createdAt: Date.now(),
  });
}

async function reserveStorage(
  ctx: MutationCtx,
  userId: Id<"users">,
  size: number,
): Promise<void> {
  const stats = await ensureUserStats(ctx, userId);
  if (stats.storageBytesExact !== true || stats.uploadCountExact !== true) {
    throw new Error("Storage migration is not complete");
  }
  const plan = await effectivePlan(ctx, userId);
  const limits = planLimits(plan);
  const storageBytes = stats.storageBytes ?? 0;
  const uploadCount = stats.uploadCount ?? 0;
  assertAdditionWithinLimit("storage bytes", storageBytes, size, limits.storageBytes, plan);
  assertWithinLimit("uploaded files", uploadCount, limits.uploads, plan);
  await ctx.db.patch(stats._id, {
    storageBytes: storageBytes + size,
    uploadCount: uploadCount + 1,
    updatedAt: Date.now(),
  });
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
    .take(MAX_PAIR_ROWS);
  let releasedBytes = 0;
  let releasedFiles = 0;
  for (const upload of uploads) {
    if (upload.userId !== userId) continue;
    const meta = upload.size === undefined ? await ctx.db.system.get(storageId) : null;
    releasedBytes += upload.size ?? meta?.size ?? 0;
    releasedFiles += 1;
    await ctx.db.delete(upload._id);
  }
  if (releasedFiles > 0) {
    const stats = await userStats(ctx, userId);
    if (stats) {
      await ctx.db.patch(stats._id, {
        storageBytes: Math.max(0, (stats.storageBytes ?? 0) - releasedBytes),
        uploadCount: Math.max(0, (stats.uploadCount ?? 0) - releasedFiles),
        updatedAt: Date.now(),
      });
    }
  }
  await ctx.storage.delete(storageId).catch(() => undefined);
}
