#!/usr/bin/env node

// Packs the free-build palette: every part the sandbox can hand you, plus all
// the primitives they are built from, in one self-contained .mpd.
//
// This is the same trick pack-models.mjs plays, for the same reason: the parts
// library is 20k files and cannot be served, so anything the runtime needs has
// to be inlined ahead of time. The difference is what goes in. A model pack
// contains the parts that model uses; a palette pack contains the parts a
// person might reach for, chosen by scripts/lib/palette-select.mjs.
//
// The root block references each part once with colour 16, "main colour", so
// nothing in the pack is committed to a colour. The runtime swaps in whichever
// colour is picked when a part is taken out of the inventory.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLibraryIndex, packModel } from "./lib/ldraw-pack.mjs";
import { selectPaletteParts } from "./lib/palette-select.mjs";
import { LIBRARY_DIR, PUBLIC_PARTS_DIR } from "./lib/paths.mjs";

/** Spacing between parts in the root block, so the raw file is not a heap. */
const LAYOUT_PITCH = 200;
const PER_ROW = 16;

/** LDraw colour 16 is "inherit from the parent", which at the top level is nothing. */
const MAIN_COLOUR = 16;

/** A type-1 reference with an identity rotation at (x, y, z). */
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
    index,
    name: "palette.ldr",
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
