#!/usr/bin/env node
// Generates NOTICES.md from the installed production dependency tree.
//
//   pnpm notices
//
// Why this is generated rather than written by hand: a notices file lists third
// party copyright lines, and the one failure mode that matters is going quietly
// stale. A dependency added, removed or bumped changes what has to be carried,
// and nothing about a hand-maintained list would say so. This reads what pnpm
// actually installed, so a diff in NOTICES.md is the honest answer to "did the
// obligations change".
//
// Scope is `--prod`: the packages whose code ends up in a deployment. Dev tools
// (biome, vitest, the type packages) are not redistributed and are not listed.
//
// The rules live in lib/notices.mjs, which is pure and tested. This file is the
// I/O half: run pnpm, read licence files off disk, write the result.

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  LICENCE_FILE,
  lockfileNames,
  missingText,
  parseLicenceList,
  platformFamilies,
  renderNotices,
  TEXT_REQUIRED,
} from "./lib/notices.mjs";
import { ROOT } from "./lib/paths.mjs";

const run = promisify(execFile);

const OUT = path.join(ROOT, "NOTICES.md");
const LOCKFILE = path.join(ROOT, "pnpm-lock.yaml");

/** Ask pnpm what is installed. Its JSON arrives grouped by licence id. */
async function installedPackages() {
  const { stdout } = await run(
    "pnpm",
    ["licenses", "list", "--prod", "--json"],
    { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
  return parseLicenceList(JSON.parse(stdout));
}

/** The package's own licence file, if it ships one. */
async function licenceText(pkg) {
  if (!pkg.path) {
    return null;
  }
  try {
    const entries = await readdir(pkg.path);
    const file = entries.find((name) => LICENCE_FILE.test(name));
    return file
      ? (await readFile(path.join(pkg.path, file), "utf8")).trim()
      : null;
  } catch {
    return null;
  }
}

/** Whether the app reaches Next's image pipeline, which is what pulls in sharp. */
async function importsNextImage() {
  const { stdout } = await run(
    "git",
    ["grep", "-lE", "from .next/image.", "--", "src"],
    { cwd: ROOT }
  ).catch(() => ({ stdout: "" }));
  return stdout.trim().length > 0;
}

/** Lockfile package names, or none if it cannot be read. */
async function lockNames() {
  try {
    return lockfileNames(await readFile(LOCKFILE, "utf8"));
  } catch {
    return new Set();
  }
}

/** Attach each package's licence text, reading all of them at once. */
async function withTexts(packages) {
  const texts = await Promise.all(packages.map(licenceText));
  for (const [index, pkg] of packages.entries()) {
    pkg.text = texts[index];
  }
  return packages;
}

/** Say which packages owe a licence text and do not ship one. */
function warnMissing(packages) {
  const owed = missingText(packages).filter((pkg) =>
    TEXT_REQUIRED.test(pkg.license)
  );
  for (const pkg of owed) {
    console.warn(
      `  warn ${pkg.name}: declares ${pkg.license} but ships no licence file`
    );
  }
}

function reportFamilies(families) {
  for (const [prefix, family] of families) {
    console.log(`- ${prefix}*: ${family.siblings.length} platform variants`);
  }
}

async function main() {
  const packages = await withTexts(await installedPackages());
  console.log(`- ${packages.length} production packages`);
  warnMissing(packages);

  const families = platformFamilies(packages, await lockNames());
  reportFamilies(families);

  const markdown = renderNotices({
    families,
    packages,
    usesNextImage: await importsNextImage(),
  });
  await writeFile(OUT, markdown);
  console.log(
    `- wrote ${path.relative(ROOT, OUT)} ` +
      `(${(markdown.length / 1024).toFixed(0)}KB)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
