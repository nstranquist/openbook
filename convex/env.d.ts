// Convex provides process.env to functions at runtime, but the convex/ tsc
// typecheck has no @types/node. Declare the global here so auth.config.ts
// (process.env.CONVEX_SITE_URL) typechecks — without pulling @types/node, which
// would clash with other ambient process declarations.
declare const process: { env: Record<string, string | undefined> };
