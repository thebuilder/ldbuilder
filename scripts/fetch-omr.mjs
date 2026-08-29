#!/usr/bin/env node
import { fetchSet } from "./lib/omr.mjs";

async function main() {
  const sets = process.argv.slice(2);
  if (sets.length === 0) {
    console.error("usage: pnpm ldraw:omr <set-number>...");
    process.exit(1);
  }

  let failures = 0;
  for (const set of sets) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one line of output per set, in the order given
      const { setId, text, metadata } = await fetchSet(set);
      const refs = text.split("\n").filter((l) => l.startsWith("1 ")).length;
      console.log(
        `  ${setId.padEnd(12)} ${String(refs).padStart(5)} refs  ` +
          `${metadata.redistributable ? "CC BY 2.0" : "NO LICENCE"}  ` +
          `${metadata.author ?? "unknown author"}` +
          `${metadata.theme ? `  (${metadata.theme})` : ""}`
      );
      if (!metadata.redistributable) {
        failures += 1;
      }
    } catch (error) {
      console.error(`  ${String(set).padEnd(12)} ${error.message}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`fetch-omr failed: ${err.message}`);
  process.exit(1);
});
