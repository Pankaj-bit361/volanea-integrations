import { defineConfig } from "tsup";

/**
 * `@volanea/integrations-core` is a devDependency, never a dependency, so tsup
 * treats it as internal and inlines it here. That is the whole mechanism
 * behind the zero-runtime-dependency promise: the published tarball contains
 * the shared code, not a link to it.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  // The type bundle must inline core too — tsup's dts rollup keeps it as an
  // import otherwise, and the published package would reference a module
  // that consumers never install.
  dts: { resolve: ["@volanea/integrations-core"] },
  clean: true,
  sourcemap: false,
  target: "node18",
  // Strapi requires the provider and calls `.init()` on the result, so the
  // CommonJS build must expose named exports directly on module.exports.
  cjsInterop: false,
});
