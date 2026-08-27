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
        "**/*.test.{ts,mjs}",
        "**/__fixtures__/**",
        // Generated from LDConfig.ldr: a 400-entry lookup table, not logic.
        "src/ldraw/colors.generated.ts",
      ],
      include: ["scripts/lib/**/*.mjs", "src/ldraw/**/*.ts", "src/lib/**/*.ts"],
      provider: "v8",
      reporter: ["text-summary", "json"],
      reportsDirectory: "coverage",
    },
    // Everything under test is pure: string and array work, plus a fake fetch.
    // Nothing here needs a DOM, and pulling one in would only slow the suite.
    environment: "node",
    include: ["{src,scripts}/**/*.test.{ts,mjs}"],
  },
});
