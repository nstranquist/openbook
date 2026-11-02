import { describe, expect, it } from "vitest";
import { boundedPaginationOptions } from "./pagination";

describe("pagination bounds", () => {
  it("clamps caller-controlled page sizes", () => {
    expect(boundedPaginationOptions({ numItems: 1_000_000, cursor: null })).toEqual({
      numItems: 50,
      cursor: null,
    });
    expect(boundedPaginationOptions({ numItems: 0, cursor: "next" })).toEqual({
      numItems: 1,
      cursor: "next",
    });
  });

  it("rejects oversized cursors", () => {
    expect(() =>
      boundedPaginationOptions({ numItems: 20, cursor: "x".repeat(2_049) }),
    ).toThrow(/invalid pagination cursor/i);
  });
});
