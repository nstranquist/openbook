const EXACT_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);
const PUSH_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"];
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Validate a browser-issued Web Push endpoint before a Node worker uses it. */
export function normalizePushEndpoint(input: string): string | null {
  if (!input || input.length > 2048) return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !EXACT_PUSH_HOSTS.has(hostname) &&
      !PUSH_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function decodeBase64Url(input: string): number[] | null {
  if (!input || input.length > 512 || !/^[A-Za-z0-9_-]+={0,2}$/.test(input)) return null;
  const unpadded = input.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  const requiredPadding = (4 - (unpadded.length % 4)) % 4;
  if (input !== unpadded && input !== `${unpadded}${"=".repeat(requiredPadding)}`) return null;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of unpadded) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  return bytes;
}

/** Validate the browser-generated P-256 public key and authentication secret. */
export function validPushSubscriptionKeys(p256dh: string, auth: string): boolean {
  const publicKey = decodeBase64Url(p256dh);
  const authSecret = decodeBase64Url(auth);
  return (
    publicKey?.length === 65 &&
    publicKey[0] === 0x04 &&
    authSecret?.length === 16
  );
}
