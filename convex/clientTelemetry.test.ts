import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

const report = {
  sourceHash: "a".repeat(64),
  fingerprint: "b".repeat(32),
  kind: "error" as const,
  message: "render failed",
  route: "/feed",
  release: "release-test",
  environment: "test",
};

describe("client telemetry ingestion", () => {
  it("stores bounded redacted reports and enforces a source window", async () => {
    const t = convexTest(schema, modules);
    for (let index = 0; index < 20; index += 1) {
      await t.mutation(internal.clientTelemetry.ingest, report);
    }
    await expect(t.mutation(internal.clientTelemetry.ingest, report)).rejects.toThrow(
      /rate limit/i,
    );
    await t.run(async (ctx) => {
      expect(await ctx.db.query("clientErrors").collect()).toHaveLength(20);
      expect(await ctx.db.query("clientErrorRateLimits").collect()).toHaveLength(1);
    });
  });

  it("rejects oversized or malformed reports", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.clientTelemetry.ingest, {
        ...report,
        sourceHash: "raw-address",
      }),
    ).rejects.toThrow(/source hash/i);
    await expect(
      t.mutation(internal.clientTelemetry.ingest, {
        ...report,
        message: "x".repeat(501),
      }),
    ).rejects.toThrow(/report/i);
  });
});
