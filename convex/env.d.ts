// Convex provides process.env to functions at runtime, but the convex/ tsc
// typecheck has no @types/node. Declare the global here so auth.config.ts
// (process.env.CONVEX_SITE_URL) typechecks — without pulling @types/node, which
// would clash with the mobile app's own ambient process declaration.
declare const process: { env: Record<string, string | undefined> };
