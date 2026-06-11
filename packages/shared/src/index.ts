// Single import surface for the whole suite. Auth hooks + input validators +
// the generated Convex api live here so app code never writes a brittle
// relative path into convex/_generated.
export * from "./schema";
export * from "./env";
export * from "./hooks";
export { createConvexClient, api } from "./convex";
export type { Doc, Id } from "./convex";
