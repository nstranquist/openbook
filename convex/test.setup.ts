// Module map for convex-test. It enumerates the Convex function modules so the
// test runtime can resolve internal/api references. We exclude modules that pull
// in deploy-time-only externals not needed by the unit tests:
//   - auth.ts / http.ts: import @auth/core OAuth providers + the Convex Auth HTTP
//     router, which need a live deployment. Excluding them keeps the VM hermetic.
//   - *.test.ts / test.setup.ts: the tests themselves.
export const modules = import.meta.glob("./**/*.ts") as Record<
  string,
  () => Promise<unknown>
>;

for (const path of Object.keys(modules)) {
  if (/\/(auth|http)\.ts$/.test(path) || /\.test\.ts$/.test(path) || /test\.setup\.ts$/.test(path)) {
    delete modules[path];
  }
}
