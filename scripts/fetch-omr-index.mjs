#!/usr/bin/env node
// Build the searchable set index the gallery's set field uses.
//
//   pnpm ldraw:index
//
// Writes public/omr-index.json, which is committed. Re-run it when the OMR has
// gained sets worth finding by name; typing a full set number works regardless.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchIndex } from "./lib/omr-index.mjs";
import { PUBLIC_DIR } from "./lib/paths.mjs";

/**
 * Rows are tuples, not objects.
 *
 * This file ships to the browser. Over 1,470 sets, repeating four key names per
 * entry costs about 40KB of pure punctuation, so the shape is documented here
 * and in src/lib/omrIndex.ts instead of in every row.
 */
const COLUMNS = ["setId", "name", "theme", "year"];
const toRow = ({ setId, name, theme, year }) => [setId, name, theme, year];

async function main() {
  const { sets, total } = await fetchIndex((message) => console.log(message));

  if (total !== null && sets.length !== total) {
    // Better to fail than to quietly ship an index missing its last page.
    throw new Error(`scraped ${sets.length} sets but the list says ${total}`);
  }

  sets.sort((a, b) => a.setId.localeCompare(b.setId, "en", { numeric: true }));

  // One set per line, and no timestamp.
  //
  // Both are for the monthly refresh workflow: with a generatedAt the file
  // changed on every run whether or not the data did, and minified it changed
  // as one 75KB line. This way an unchanged list produces an identical file,
  // and a changed one produces a diff that reads as "these sets were added".
  // The whitespace costs 0.5KB gzipped.
  const rows = sets.map((set) => `    ${JSON.stringify(toRow(set))}`);
  const json = [
    "{",
    `  "columns": ${JSON.stringify(COLUMNS)},`,
    '  "sets": [',
    rows.join(",\n"),
    "  ]",
    "}",
  ].join("\n");

  const file = path.join(PUBLIC_DIR, "omr-index.json");
  await writeFile(file, `${json}\n`);

  console.log(
    `- wrote ${sets.length} sets to ${path.relative(process.cwd(), file)} ` +
      `(${(json.length / 1024).toFixed(0)}KB)`
  );
}

main().catch((err) => {
  console.error(`fetch-omr-index failed: ${err.message}`);
  process.exit(1);
});
