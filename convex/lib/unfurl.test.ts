import { describe, it, expect } from "vitest";
import {
  extractFirstHttpUrl,
  isPublicIpAddress,
  normalizePreviewUrl,
  parseOpenGraph,
} from "./unfurl";

describe("unfurl", () => {
  it("extracts a public https URL and rejects local destinations", () => {
    expect(extractFirstHttpUrl("see https://example.com/a and more")).toBe(
      "https://example.com/a",
    );
    expect(extractFirstHttpUrl("nope http://127.0.0.1/secret")).toBeNull();
    expect(extractFirstHttpUrl("nope http://2130706433/secret")).toBeNull();
    expect(extractFirstHttpUrl("nope http://[::ffff:127.0.0.1]/secret")).toBeNull();
    expect(extractFirstHttpUrl("nope https://router.lan/secret")).toBeNull();
    expect(extractFirstHttpUrl("plain text")).toBeNull();
  });

  it("allows only unambiguous public HTTP destinations", () => {
    expect(normalizePreviewUrl("https://user:pass@example.com/")).toBeNull();
    expect(normalizePreviewUrl("https://example.com:8443/")).toBeNull();
    expect(normalizePreviewUrl("https://intranet/")).toBeNull();
    expect(normalizePreviewUrl("file:///etc/passwd")).toBeNull();
    expect(normalizePreviewUrl("https://example.com/a#fragment")).toBe(
      "https://example.com/a",
    );

    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "172.31.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("parses Open Graph tags", () => {
    const html = `<html><head>
      <meta property="og:title" content="Hello" />
      <meta property="og:description" content="World" />
      <meta property="og:image" content="/img.png" />
      <title>Fallback</title>
    </head></html>`;
    const parsed = parseOpenGraph(html, "https://example.com/post");
    expect(parsed.title).toBe("Hello");
    expect(parsed.description).toBe("World");
    expect(parsed.imageUrl).toBe("https://example.com/img.png");
  });

  it("drops a private Open Graph image URL", () => {
    const html = `<meta property="og:title" content="Hello" />
      <meta property="og:image" content="http://169.254.169.254/latest" />`;
    expect(parseOpenGraph(html, "https://example.com/post")).toEqual({
      url: "https://example.com/post",
      title: "Hello",
      description: undefined,
      imageUrl: undefined,
    });
  });
});
