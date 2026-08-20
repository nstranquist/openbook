import type { Id } from "@openbook/shared";

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_VIDEO_BYTES = 32_000_000;

// Re-encode still images on a canvas so EXIF / GPS / camera tags do not
// leave the device. GIFs keep the original bytes (canvas would flatten them).
export async function stripImageMetadata(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.92),
  );
  return blob ?? file;
}

export async function uploadStorageFile(
  file: File,
  generateUploadUrl: () => Promise<string>,
): Promise<Id<"_storage">> {
  const res = await fetch(await generateUploadUrl(), {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  const json = (await res.json()) as { storageId: Id<"_storage"> };
  return json.storageId;
}
