import { describe, it, expect } from "vitest";
import { assertSafeReturnUrl, flattenForm, verifyStripeSignature } from "./stripe";

// Pure-function coverage for the Stripe REST/webhook primitives. No network and
// no Convex db — these are the load-bearing crypto + encoding paths a wrong edit
// would silently break (a bad signature check = forged events mutate billing).

describe("flattenForm (Stripe bracket encoding)", () => {
  it("encodes nested arrays of objects", () => {
    expect(flattenForm({ mode: "subscription", line_items: [{ price: "price_123", quantity: 1 }] })).toEqual({
      mode: "subscription",
      "line_items[0][price]": "price_123",
      "line_items[0][quantity]": "1",
    });
  });
  it("drops undefined/null and stringifies scalars", () => {
    expect(flattenForm({ a: 1, b: undefined, c: null, d: true })).toEqual({ a: "1", d: "true" });
  });
});

async function signHeader(payload: string, secret: string, ts: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${ts},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ type: "checkout.session.completed" });

  it("accepts a fresh, correctly signed payload", async () => {
    const now = 1_700_000_000;
    expect(await verifyStripeSignature(payload, await signHeader(payload, secret, now), secret, now)).toBe(true);
  });
  it("rejects a tampered payload", async () => {
    const now = 1_700_000_000;
    expect(await verifyStripeSignature(payload + "x", await signHeader(payload, secret, now), secret, now)).toBe(false);
  });
  it("rejects a wrong signing secret", async () => {
    const now = 1_700_000_000;
    expect(await verifyStripeSignature(payload, await signHeader(payload, secret, now), "whsec_wrong", now)).toBe(false);
  });
  it("rejects an expired timestamp (outside tolerance)", async () => {
    const at = 1_700_000_000;
    expect(await verifyStripeSignature(payload, await signHeader(payload, secret, at), secret, at + 10_000)).toBe(false);
  });
  it("rejects a malformed header", async () => {
    expect(await verifyStripeSignature(payload, "garbage", secret)).toBe(false);
    expect(await verifyStripeSignature(payload, "t=123", secret)).toBe(false);
  });
});

describe("assertSafeReturnUrl", () => {
  const site = "https://openbook.example";
  it("allows the deployment origin and local http hosts", () => {
    expect(() =>
      assertSafeReturnUrl("https://openbook.example/?billing=success", { siteUrl: site }),
    ).not.toThrow();
    expect(() =>
      assertSafeReturnUrl("http://127.0.0.1:5173/?billing=success", { siteUrl: site }),
    ).not.toThrow();
  });
  it("rejects an attacker origin", () => {
    expect(() =>
      assertSafeReturnUrl("https://evil.example/phish", { siteUrl: site }),
    ).toThrow(/not allowed/i);
  });
  it("rejects javascript and credentialed URLs", () => {
    expect(() => assertSafeReturnUrl("javascript:alert(1)", { siteUrl: site })).toThrow();
    expect(() =>
      assertSafeReturnUrl("https://user:pass@openbook.example/", { siteUrl: site }),
    ).toThrow(/credentials/i);
  });
});
