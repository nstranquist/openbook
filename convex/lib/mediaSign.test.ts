import { afterEach, describe, it, expect } from "vitest";
import {
  mediaCacheControl,
  mediaSiteOrigin,
  parseMediaRange,
  signMedia,
  verifyMedia,
} from "./mediaSign";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

describe("media HMAC", () => {
  it("accepts a fresh signature and rejects a bad one", async () => {
    const id = "kgxxxxxxxxxxxxxxxxxxxxxxxxxxxx" as never;
    const exp = Date.now() + 60_000;
    const sig = await signMedia(id, exp);
    expect(await verifyMedia(id, exp, sig)).toBe(true);
    expect(await verifyMedia(id, exp, "00".repeat(32))).toBe(false);
    expect(await verifyMedia(id, Date.now() - 1, sig)).toBe(false);
  });

  it("requires an independent secret in production", async () => {
    process.env.OPENBOOK_ENV = "production";
    delete process.env.MEDIA_SIGNING_SECRET;
    await expect(signMedia("kgxxxxxxxxxxxxxxxxxxxxxxxxxxxx" as never, Date.now() + 60_000)).rejects.toThrow(
      "MEDIA_SIGNING_SECRET is required in production",
    );
  });

  it("requires an exact media origin in production", () => {
    process.env.OPENBOOK_ENV = "production";
    delete process.env.CONVEX_SITE_URL;
    expect(() => mediaSiteOrigin()).toThrow("CONVEX_SITE_URL is required in production");
    process.env.CONVEX_SITE_URL = "https://openbook.convex.site";
    expect(mediaSiteOrigin()).toBe("https://openbook.convex.site");
    process.env.CONVEX_SITE_URL = "https://user:secret@openbook.convex.site";
    expect(() => mediaSiteOrigin()).toThrow("CONVEX_SITE_URL is required in production");
  });

  it("parses one bounded media byte range", () => {
    expect(parseMediaRange(null, 100)).toBeUndefined();
    expect(parseMediaRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseMediaRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseMediaRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseMediaRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
    expect(parseMediaRange("bytes=100-", 100)).toBeNull();
    expect(parseMediaRange("bytes=0-1,4-5", 100)).toBeNull();
  });

  it("never caches media beyond the signature expiry", () => {
    expect(mediaCacheControl(4_600_000, 1_000_000)).toBe(
      "public, max-age=3600, immutable",
    );
    expect(mediaCacheControl(1_030_500, 1_000_000)).toBe(
      "public, max-age=30, immutable",
    );
    expect(mediaCacheControl(999_000, 1_000_000)).toBe(
      "public, max-age=0, immutable",
    );
  });
});
