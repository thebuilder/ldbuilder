import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the parts of the app that are not a renderer.
 *
 * Most of this is string and array work: the packer's naming rules, the build
 * state machine, step synthesis, the saved-game store, the search ranking. The
 * scene layer needs a GL context and is checked by hand in a browser, but the
 * logic underneath it runs headless, three.js and rapier included, as long as
 * nothing asks for a `WebGLRenderer`.
 *
 * Coverage is emitted in Istanbul format because `fallow audit` reads it to
 * score complexity. Without it every function is assumed untested and CRAP
 * collapses into a second, much stricter cyclomatic threshold.
 */
export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig, which vitest does not read.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    coverage: {
      exclude: [
        "**/*.test.{ts,mjs,tsx}",
        "src/test/**",
        "**/__fixtures__/**",
        // Generated from LDConfig.ldr: a 400-entry lookup table, not logic.
        "src/ldraw/colors.generated.ts",
      ],
      include: [
        "src/**/*.{ts,tsx}",
        // The packer and the OMR readers are shared with the API routes, and
        // the rules that decide the free-build palette ship as data, so both
        // are held to the same bar as the code that reads them.
        "scripts/lib/**/*.mjs",
      ],
      provider: "v8",
      reporter: ["text-summary", "json"],
      reportsDirectory: "coverage",
    },
    // Node by default, because a DOM would only slow the majority down.
    // Component suites opt in with a `@vitest-environment` docblock.
    environment: "node",
    include: ["{src,scripts}/**/*.test.{ts,mjs,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
