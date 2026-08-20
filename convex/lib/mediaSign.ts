import type { Id } from "../_generated/dataModel";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(message: string): Promise<string> {
  const secret =
    process.env.MEDIA_SIGNING_SECRET || process.env.SITE_URL || "openbook-dev-media";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

export const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function signMedia(
  storageId: Id<"_storage">,
  exp: number,
): Promise<string> {
  return await hmacHex(`${storageId}.${exp}`);
}

export async function verifyMedia(
  storageId: string,
  exp: number,
  sig: string,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(`${storageId}.${exp}`);
  return timingSafeEqualHex(expected, sig.toLowerCase());
}

export function mediaSiteOrigin(): string {
  return (process.env.CONVEX_SITE_URL || process.env.SITE_URL || "").replace(/\/$/, "");
}

export async function signedMediaUrl(
  storageId: Id<"_storage">,
): Promise<string | null> {
  const origin = mediaSiteOrigin();
  if (!origin) return null;
  const exp = Date.now() + MEDIA_TTL_MS;
  const sig = await signMedia(storageId, exp);
  return `${origin}/media?id=${encodeURIComponent(storageId)}&exp=${exp}&sig=${sig}`;
}
