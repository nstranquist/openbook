import type { Id } from "../_generated/dataModel";
import { requireProductionSecret } from "./runtime";

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
  const secret = requireProductionSecret("MEDIA_SIGNING_SECRET", "openbook-dev-media");
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

export const MEDIA_TTL_MS = 60 * 60 * 1000;

export function mediaCacheControl(exp: number, now = Date.now()): string {
  const remainingSeconds = Math.max(0, Math.floor((exp - now) / 1000));
  return `public, max-age=${Math.min(3600, remainingSeconds)}, immutable`;
}

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
  const raw = (process.env.CONVEX_SITE_URL ?? "").trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      const bare =
        parsed.host &&
        !parsed.username &&
        !parsed.password &&
        (parsed.pathname === "" || parsed.pathname === "/") &&
        !parsed.search &&
        !parsed.hash;
      const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
      if (bare && (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))) {
        return parsed.origin;
      }
    } catch {
      // Production fails closed below. Development can use direct storage URLs.
    }
  }
  if ((process.env.OPENBOOK_ENV ?? "").trim() === "production") {
    throw new Error("CONVEX_SITE_URL is required in production");
  }
  return "";
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

export type MediaRange = { start: number; end: number };

/** Parse one RFC 7233 byte range. Multiple ranges are intentionally unsupported. */
export function parseMediaRange(header: string | null, size: number): MediaRange | null | undefined {
  if (header === null) return undefined;
  if (!Number.isSafeInteger(size) || size <= 0 || header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
