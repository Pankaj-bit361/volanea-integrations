import { defineConfig } from "tsup";

/**
 * Core is never published — but it IS built, because the two providers inline
 * its types at build time. tsup emits a single flat `dist/index.d.ts` with no
 * relative imports, which is the only shape that survives being inlined: a
 * d.ts that still said `from "./errors"` would ship a dangling reference into
 * every published tarball.
 *
 * That makes core a build-order dependency of the other two. The root `build`
 * script and each package's `prebuild` both build it first.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: true,
  clean: true,
  target: "node18",
});
