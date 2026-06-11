import { ConvexReactClient } from "convex/react";

// The ONE place in the suite that reaches across to the generated backend API.
// Every platform imports `api`, `Doc`, and `Id` from @openbook/shared
// instead of writing a brittle relative path to convex/_generated.
//
// `convex/_generated` is created by `npx convex dev`; until then your editor
// will flag these two imports — that is expected before first generation.
export { api } from "../../../convex/_generated/api";
export type { Doc, Id } from "../../../convex/_generated/dataModel";

// Construct the reactive client a platform binds its ConvexProvider to.
export function createConvexClient(url: string): ConvexReactClient {
  return new ConvexReactClient(url);
}
