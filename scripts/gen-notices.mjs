#!/usr/bin/env node
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

async function installedPackages() {
  const { stdout } = await run(
    "pnpm",
    ["licenses", "list", "--prod", "--json"],
    { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
  return parseLicenceList(JSON.parse(stdout));
}

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

async function importsNextImage() {
  const { stdout } = await run(
    "git",
    ["grep", "-lE", "from .next/image.", "--", "src"],
    { cwd: ROOT }
  ).catch(() => ({ stdout: "" }));
  return stdout.trim().length > 0;
}

async function lockNames() {
  try {
    return lockfileNames(await readFile(LOCKFILE, "utf8"));
  } catch {
    return new Set();
  }
}

async function withTexts(packages) {
  const texts = await Promise.all(packages.map(licenceText));
  for (const [index, pkg] of packages.entries()) {
    pkg.text = texts[index];
  }
  return packages;
}

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
