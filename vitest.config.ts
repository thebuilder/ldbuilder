import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig, which vitest does not read.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    coverage: {
      // coverage-final.json is Istanbul-shaped, which is what fallow's
      // health.coverage wants so its CRAP scores mean something.
      exclude: [
        "**/*.test.{ts,mjs,tsx}",
        "src/test/**",
        "**/__fixtures__/**",
        // Generated from LDConfig.ldr: a 400-entry lookup table, not logic.
        "src/ldraw/colors.generated.ts",
      ],
      include: [
        "scripts/lib/**/*.mjs",
        "src/components/**/*.tsx",
        "src/ldraw/**/*.ts",
        "src/lib/**/*.ts",
      ],
      provider: "v8",
      reporter: ["text-summary", "json"],
      reportsDirectory: "coverage",
    },
    // Node by default: most of what is tested here is string and array work
    // plus a fake fetch, and a DOM would only slow it down. Component suites
    // opt in with a `@vitest-environment happy-dom` docblock.
    environment: "node",
    include: ["{src,scripts}/**/*.test.{ts,mjs,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
