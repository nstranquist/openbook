import { z } from "zod";

// Resolve the client-exposed Convex URL regardless of which bundler prefix the
// platform uses (Vite -> VITE_, Expo -> EXPO_PUBLIC_). One contract, many hosts.
export function resolveConvexUrl(
  env: Record<string, string | undefined>,
): string {
  const url =
    env.VITE_CONVEX_URL ?? env.EXPO_PUBLIC_CONVEX_URL ?? env.CONVEX_URL;
  return z
    .string()
    .url("Set VITE_CONVEX_URL / EXPO_PUBLIC_CONVEX_URL to your Convex deployment URL")
    .parse(url);
}
