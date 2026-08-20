import { describe, it, expect } from "vitest";
import { signMedia, verifyMedia } from "./mediaSign";

describe("media HMAC", () => {
  it("accepts a fresh signature and rejects a bad one", async () => {
    const id = "kgxxxxxxxxxxxxxxxxxxxxxxxxxxxx" as never;
    const exp = Date.now() + 60_000;
    const sig = await signMedia(id, exp);
    expect(await verifyMedia(id, exp, sig)).toBe(true);
    expect(await verifyMedia(id, exp, "00".repeat(32))).toBe(false);
    expect(await verifyMedia(id, Date.now() - 1, sig)).toBe(false);
  });
});
