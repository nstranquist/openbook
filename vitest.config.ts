import { defineConfig } from "vitest/config";

// Convex function tests run in the edge-runtime VM (the same V8-style runtime
// Convex functions execute in) via convex-test. See convex/**/*.test.ts.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
