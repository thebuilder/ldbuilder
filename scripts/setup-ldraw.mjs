#!/usr/bin/env node

// Downloads the official LDraw parts library and extracts it to ./ldraw-library.
//
// The library is ~138MB zipped and expands to ~20k files, so it is gitignored.
// It is only needed to *pack* models (see pack-models.mjs) and to serve the
// /api/pack route. The committed .mpd files in public/models are self-contained,
// so running the app never requires this.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CACHE_DIR, LIBRARY_DIR, PUBLIC_LDRAW_DIR } from "./lib/paths.mjs";

const LIBRARY_URL = "https://library.ldraw.org/library/updates/complete.zip";
const ZIP_PATH = path.join(CACHE_DIR, "complete.zip");

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download() {
  if (await exists(ZIP_PATH)) {
    const { size } = await stat(ZIP_PATH);
    console.log(
      `- cached archive found (${(size / 1e6).toFixed(0)} MB), skipping download`
    );
    return;
  }
  console.log(`- downloading ${LIBRARY_URL}`);
  await mkdir(CACHE_DIR, { recursive: true });
  const res = await fetch(LIBRARY_URL);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    seen += chunk.length;
    if (!total) {
      return;
    }
    const pct = Math.floor((seen / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      process.stdout.write(`\r  ${pct}%`);
    }
  });
  // Write to a temp path so an interrupted download is never mistaken for a cache hit.
  const tmp = `${ZIP_PATH}.partial`;
  await pipeline(body, createWriteStream(tmp));
  const { rename } = await import("node:fs/promises");
  await rename(tmp, ZIP_PATH);
  process.stdout.write("\r  100%\n");
}

function unzip() {
  // `unzip` ships with macOS and every mainstream Linux image, and handles a
  // 20k-entry archive far faster than a JS implementation.
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "unzip",
      ["-qq", "-o", ZIP_PATH, "-d", path.dirname(LIBRARY_DIR)],
      {
        stdio: ["ignore", "inherit", "inherit"],
      }
    );
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`unzip exited with code ${code}`))
    );
  });
}

async function main() {
  await download();

  if (await exists(path.join(LIBRARY_DIR, "LDConfig.ldr"))) {
    console.log("- library already extracted, skipping unzip");
  } else {
    console.log(`- extracting to ${LIBRARY_DIR}`);
    // The archive contains a top-level `ldraw/` folder, which is why we extract
    // into the parent and let it create ldraw-library's sibling, then rename.
    const extractedRoot = path.join(path.dirname(LIBRARY_DIR), "ldraw");
    await rm(extractedRoot, { force: true, recursive: true });
    await unzip();
    const { rename } = await import("node:fs/promises");
    await rm(LIBRARY_DIR, { force: true, recursive: true });
    await rename(extractedRoot, LIBRARY_DIR);
  }

  await mkdir(PUBLIC_LDRAW_DIR, { recursive: true });
  await copyFile(
    path.join(LIBRARY_DIR, "LDConfig.ldr"),
    path.join(PUBLIC_LDRAW_DIR, "LDConfig.ldr")
  );
  console.log("- copied LDConfig.ldr into public/ldraw");

  console.log("\nDone. Next: pnpm ldraw:colors && pnpm ldraw:pack");
}

main().catch((err) => {
  console.error(`\nsetup failed: ${err.message}`);
  process.exit(1);
});
