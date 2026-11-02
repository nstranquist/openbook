const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
  ".home.arpa",
];

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (
    bytes.some(
      (byte, index) =>
        !/^\d{1,3}$/.test(parts[index] ?? "") ||
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255,
    )
  ) {
    return null;
  }
  return bytes;
}

function parseIpv6(address: string): number[] | null {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value.includes("%") || value.split("::").length > 2) return null;

  const convert = (parts: string[]): number[] | null => {
    const words: number[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      if (part.includes(".")) {
        if (index !== parts.length - 1) return null;
        const ipv4 = parseIpv4(part);
        if (!ipv4) return null;
        words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };

  const [leftText, rightText] = value.split("::");
  const left = convert(leftText ? leftText.split(":") : []);
  const right = convert(rightText ? rightText.split(":") : []);
  if (!left || !right) return null;
  if (!value.includes("::")) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

/** Return true only for globally routable unicast IP addresses. */
export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (a === 0 || a === 10 || a === 127 || a! >= 224) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }

  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return false;
  // IPv4-mapped IPv6 addresses use the IPv4 policy.
  if (
    ipv6.slice(0, 5).every((word) => word === 0) &&
    ipv6[5] === 0xffff
  ) {
    return isPublicIpAddress(
      `${ipv6[6]! >> 8}.${ipv6[6]! & 0xff}.${ipv6[7]! >> 8}.${ipv6[7]! & 0xff}`,
    );
  }
  // Permit global unicast only. Exclude documentation, transition, benchmark,
  // and ORCHID ranges that can encode or route to a non-public destination.
  if ((ipv6[0]! & 0xe000) !== 0x2000) return false;
  if (ipv6[0] === 0x2002) return false;
  if (ipv6[0] === 0x2001) {
    const second = ipv6[1]!;
    if (second === 0 || second === 2 || second === 0x0db8) return false;
    if ((second & 0xfff0) === 0x0010 || (second & 0xfff0) === 0x0020) return false;
  }
  return true;
}

/** Normalize a link-preview URL and reject local or ambiguous destinations. */
export function normalizePreviewUrl(input: string): string | null {
  if (!input || input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || BLOCKED_HOSTS.has(host)) return null;
    if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    if (!host.includes(":") && !host.includes(".") && !parseIpv4(host)) return null;
    if ((parseIpv4(host) || host.includes(":")) && !isPublicIpAddress(host)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function extractFirstHttpUrl(body: string): string | null {
  const match = body.match(URL_RE);
  if (!match) return null;
  return normalizePreviewUrl(match[0].replace(/[.,);]+$/, ""));
}

export function parseOpenGraph(html: string, pageUrl: string): {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
} {
  const prop = (name: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      "i",
    );
    return html.match(re)?.[1] || html.match(alt)?.[1];
  };
  const title =
    prop("og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = prop("og:description") || prop("description");
  let imageUrl = prop("og:image");
  if (imageUrl) {
    try {
      imageUrl = normalizePreviewUrl(new URL(imageUrl, pageUrl).toString()) ?? undefined;
    } catch {
      imageUrl = undefined;
    }
  }
  return {
    url: pageUrl,
    title: title?.slice(0, 200),
    description: description?.slice(0, 400),
    imageUrl,
  };
}
