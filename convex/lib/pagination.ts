import type { PaginationOptions } from "convex/server";

export const MAX_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 2_048;

export function boundedPaginationOptions(
  options: PaginationOptions,
): PaginationOptions {
  if (options.cursor !== null && options.cursor.length > MAX_CURSOR_LENGTH) {
    throw new Error("Invalid pagination cursor");
  }
  const requested = Number.isFinite(options.numItems)
    ? Math.floor(options.numItems)
    : 1;
  return {
    cursor: options.cursor,
    numItems: Math.max(1, Math.min(requested, MAX_PAGE_SIZE)),
  };
}
