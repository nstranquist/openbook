import { z } from "zod";

// Resolve the Vite-exposed Convex URL. CONVEX_URL is accepted as a fallback
// for scripts that do not use the Vite prefix.
export function resolveConvexUrl(
  env: Record<string, string | undefined>,
): string {
  const url = env.VITE_CONVEX_URL ?? env.CONVEX_URL;
  return z
    .string()
    .url("Set VITE_CONVEX_URL to your Convex deployment URL")
    .parse(url);
}
