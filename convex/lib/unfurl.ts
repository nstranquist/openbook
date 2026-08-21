const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function extractFirstHttpUrl(body: string): string | null {
  const match = body.match(URL_RE);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[.,);]+$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return null;
    if (host === "127.0.0.1" || host === "::1" || host.startsWith("10.") || host.startsWith("192.168."))
      return null;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    if (host === "169.254.169.254" || host.endsWith(".internal")) return null;
    return url.toString();
  } catch {
    return null;
  }
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
      imageUrl = new URL(imageUrl, pageUrl).toString();
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
