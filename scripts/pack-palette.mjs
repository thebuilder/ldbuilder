#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildLibraryIndex,
  localResolver,
  packModel,
} from "./lib/ldraw-pack.mjs";
import { selectPaletteParts } from "./lib/palette-select.mjs";
import { LIBRARY_DIR, PUBLIC_PARTS_DIR } from "./lib/paths.mjs";

const LAYOUT_PITCH = 200;
const PER_ROW = 16;

const MAIN_COLOUR = 16;

function reference(file, index) {
  const x = (index % PER_ROW) * LAYOUT_PITCH;
  const z = Math.floor(index / PER_ROW) * LAYOUT_PITCH;
  return `1 ${MAIN_COLOUR} ${x} 0 ${z} 1 0 0 0 1 0 0 0 1 ${file}`;
}

function report(groups, parts) {
  console.log(
    `- selected ${parts.length} parts across ${groups.length} groups`
  );
  for (const group of groups) {
    console.log(`    ${group.label}: ${group.parts.length}`);
  }
}

/**
 * A palette with holes in it would offer parts that render as nothing, so an
 * incomplete pack is a build failure rather than a warning.
 */
function checkComplete(parts, missing) {
  if (parts.length === 0) {
    throw new Error(
      "no palette parts found; run `pnpm ldraw:setup` to install the library"
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} unresolved references: ${missing.slice(0, 8).join(", ")}`
    );
  }
}

async function main() {
  const groups = await selectPaletteParts(LIBRARY_DIR);
  const parts = groups.flatMap((group) => group.parts);
  checkComplete(parts, []);
  report(groups, parts);

  const { index } = await buildLibraryIndex(LIBRARY_DIR);

  const source = [
    "0 Free build palette",
    "0 Name: palette.ldr",
    "0 !LDRAW_ORG Model",
    ...parts.map((part, i) => reference(part.file, i)),
    "",
  ].join("\n");

  const { mpd, partNames, missing, stats } = await packModel({
    name: "palette.ldr",
    resolve: localResolver(index),
    text: source,
  });

  checkComplete(parts, missing);

  await mkdir(PUBLIC_PARTS_DIR, { recursive: true });
  await writeFile(path.join(PUBLIC_PARTS_DIR, "palette.mpd"), mpd);

  // Descriptions come from the library rather than from the selection rules, so
  // the inventory shows the part's own name even where a rule matched loosely.
  // They are space-aligned in the source ("Brick  1 x  2"), which HTML collapses
  // on screen but a search box does not.
  const tidy = (name) => name.trim().replace(/\s+/g, " ");
  const catalogue = {
    groups: groups.map((group) => ({
      id: group.id,
      label: group.label,
      parts: group.parts.map((part) => ({
        file: part.file,
        name: tidy(partNames[part.file.toLowerCase()] ?? part.name),
        size: part.size,
      })),
    })),
  };
  await writeFile(
    path.join(PUBLIC_PARTS_DIR, "palette.json"),
    `${JSON.stringify(catalogue, null, 2)}\n`
  );

  console.log(
    `- wrote palette.mpd: ${parts.length} parts, ${stats.files} files, ${(stats.bytes / 1e6).toFixed(2)} MB`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
