import { describe, expect, it } from "vitest";
import { normalizePushEndpoint, validPushSubscriptionKeys } from "./pushEndpoint";

describe("Web Push endpoint policy", () => {
  it("allows supported browser push services", () => {
    expect(normalizePushEndpoint("https://fcm.googleapis.com/fcm/send/token")).toBe(
      "https://fcm.googleapis.com/fcm/send/token",
    );
    expect(
      normalizePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/token"),
    ).toBe("https://updates.push.services.mozilla.com/wpush/v2/token");
    expect(normalizePushEndpoint("https://web.push.apple.com/Qtoken")).toBe(
      "https://web.push.apple.com/Qtoken",
    );
    expect(normalizePushEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=x")).toBe(
      "https://wns2-bl2p.notify.windows.com/w/?token=x",
    );
  });

  it("rejects arbitrary, local, credentialed, and custom-port endpoints", () => {
    for (const endpoint of [
      "https://attacker.example/push",
      "https://127.0.0.1/push",
      "https://user:pass@fcm.googleapis.com/push",
      "https://fcm.googleapis.com:8443/push",
      "http://fcm.googleapis.com/push",
    ]) {
      expect(normalizePushEndpoint(endpoint), endpoint).toBeNull();
    }
  });

  it("accepts only canonical browser key material", () => {
    const p256dh = Buffer.from([0x04, ...new Array(64).fill(0x01)]).toString("base64url");
    const auth = Buffer.from(new Array(16).fill(0x02)).toString("base64url");
    expect(validPushSubscriptionKeys(p256dh, auth)).toBe(true);
    expect(validPushSubscriptionKeys(`${p256dh}=`, auth)).toBe(true);
    expect(validPushSubscriptionKeys(Buffer.from(new Array(65).fill(1)).toString("base64url"), auth)).toBe(false);
    expect(validPushSubscriptionKeys(p256dh, "not-a-16-byte-secret")).toBe(false);
    expect(validPushSubscriptionKeys(`${p256dh}===`, auth)).toBe(false);
  });
});
