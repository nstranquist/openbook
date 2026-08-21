import { describe, it, expect } from "vitest";
import { extractFirstHttpUrl, parseOpenGraph } from "./unfurl";

describe("unfurl", () => {
  it("extracts a public https URL and rejects loopback", () => {
    expect(extractFirstHttpUrl("see https://example.com/a and more")).toBe(
      "https://example.com/a",
    );
    expect(extractFirstHttpUrl("nope http://127.0.0.1/secret")).toBeNull();
    expect(extractFirstHttpUrl("plain text")).toBeNull();
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
});
