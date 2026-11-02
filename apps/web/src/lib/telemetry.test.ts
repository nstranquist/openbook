import { describe, expect, it } from "vitest";
import { errorFingerprint, sanitizeErrorText } from "./telemetry";

describe("client telemetry redaction", () => {
  it("removes credentials and likely personal data", () => {
    const result = sanitizeErrorText(
      "Bearer secret-token contact person@example.com at https://example.com/path?token=secret /Users/nico/project",
    );
    expect(result).not.toContain("secret-token");
    expect(result).not.toContain("person@example.com");
    expect(result).not.toContain("token=secret");
    expect(result).not.toContain("/Users/nico");
    expect(result).toContain("[email]");
  });

  it("creates stable, non-plaintext fingerprints", async () => {
    const first = await errorFingerprint("error", "render failed", "at App");
    const second = await errorFingerprint("error", "render failed", "at App");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toContain("render");
  });
});
