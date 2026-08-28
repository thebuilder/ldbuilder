// Turns an installed dependency tree into the text of NOTICES.md.
//
// Everything here is pure: the CLI in scripts/gen-notices.mjs does the running
// and reading and hands the results over. That split is what makes the rules
// below testable, and they are the part worth testing, because getting one
// wrong means shipping a notice that quietly under-reports what it owes.

/**
 * The platform suffix on a prebuilt binary package: `@next/swc-darwin-arm64`.
 *
 * These matter because only the current machine's variant is installed, so a
 * notices file generated on a Mac would silently omit what a Linux deployment
 * actually ships. The siblings are read out of the lockfile instead.
 */
const PLATFORM_SUFFIX =
  /-(darwin|linux|linuxmusl|win32|freebsd|wasm32|webcontainers)[a-z0-9-]*$/;

/** Files a package might keep its licence in. */
export const LICENCE_FILE = /^(licen[cs]e|notice|copying)/i;

/**
 * Licences whose text has to travel with a redistribution rather than just a
 * copyright line. Apache-2.0 section 4(a) and the BSD clauses are explicit;
 * MIT and ISC ask for the notice, which is the text.
 *
 * Every licence here is reproduced anyway, so this only drives the warning for
 * a package that ships no licence file at all.
 */
export const TEXT_REQUIRED = /^(Apache|BSD|MIT|ISC|LGPL|MPL)/i;

/** Weak copyleft carries obligations the permissive licences do not. */
const COPYLEFT = /^(LGPL|GPL|MPL|EPL|CDDL)/i;

/** Package names in a pnpm lockfile, without their version suffix. */
export function lockfileNames(text) {
  const names = new Set();
  for (const [, name] of text.matchAll(
    /^ {2}'?(@?[^'@\s]+(?:\/[^'@\s]+)?)@/gm
  )) {
    names.add(name);
  }
  return names;
}

/** Flatten `pnpm licenses list --json`, which arrives grouped by licence id. */
export function parseLicenceList(grouped) {
  const packages = [];
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      packages.push({
        homepage: entry.homepage ?? null,
        license,
        name: entry.name,
        path: entry.paths?.[0] ?? null,
        text: null,
        version: entry.versions?.join(", ") ?? "",
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** The family prefix of a prebuilt package: `@img/sharp-darwin-arm64` -> `@img/sharp-`. */
const familyPrefix = (name) => name.replace(PLATFORM_SUFFIX, "-");

/**
 * Every platform variant of each installed prebuilt package.
 *
 * Siblings are matched on the stripped prefix rather than with `startsWith`, or
 * the `@img/sharp-*` family swallows `@img/sharp-libvips-*` whole and reports
 * 26 variants for a family of 16.
 */
export function platformFamilies(packages, lockNames) {
  const families = new Map();
  const names = [...lockNames].filter((name) => PLATFORM_SUFFIX.test(name));

  for (const pkg of packages) {
    if (!PLATFORM_SUFFIX.test(pkg.name)) {
      continue;
    }
    const prefix = familyPrefix(pkg.name);
    const siblings = names.filter((n) => familyPrefix(n) === prefix).sort();
    if (siblings.length > 1) {
      families.set(prefix, { installed: pkg, license: pkg.license, siblings });
    }
  }
  return families;
}

/**
 * Group packages by the exact licence text they ship.
 *
 * Keyed on the text rather than the licence id, because two MIT packages carry
 * different copyright lines and both have to be reproduced, while six
 * Apache-2.0 packages carry one identical file and need it once.
 */
export function groupByText(packages) {
  const groups = new Map();
  for (const pkg of packages) {
    if (pkg.text === null) {
      continue;
    }
    const existing = groups.get(pkg.text);
    if (existing) {
      existing.push(pkg);
    } else {
      groups.set(pkg.text, [pkg]);
    }
  }
  return groups;
}

/** Packages declaring a licence whose text they do not ship. */
export const missingText = (packages) =>
  packages.filter((pkg) => pkg.text === null);

const bullet = (pkg) => `- \`${pkg.name}\` ${pkg.version} — ${pkg.license}`;

function inventorySection(packages) {
  const licences = [...new Set(packages.map((pkg) => pkg.license))].sort();
  const rows = packages.map((pkg) => {
    const name = pkg.homepage
      ? `[${pkg.name}](${pkg.homepage})`
      : `\`${pkg.name}\``;
    return `| ${name} | ${pkg.version} | ${pkg.license} |`;
  });

  return [
    `${packages.length} packages, under: ${licences.join(", ")}.`,
    "",
    "## Inventory",
    "",
    "| Package | Version | Licence |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ];
}

function missingSection(packages) {
  const missing = missingText(packages);
  if (missing.length === 0) {
    return [];
  }
  return [
    "## Packages shipping no licence file",
    "",
    "These declare a licence in their `package.json` but include no licence file",
    "to reproduce. The declared identifier is authoritative for them.",
    "",
    ...missing.map(bullet),
    "",
  ];
}

function familyEntry({ installed, license, siblings }) {
  return [
    `\`${familyPrefix(installed.name)}*\` — ${license}, ${siblings.length} ` +
      `variants. Installed here: \`${installed.name}\`.`,
    "",
    siblings.map((name) => `\`${name}\``).join(", "),
    "",
  ];
}

function platformSection(families) {
  if (families.size === 0) {
    return [];
  }
  return [
    "## Platform-specific binaries",
    "",
    "These packages ship a prebuilt binary per platform, and only the current",
    "machine's variant is installed. A deployment installs a sibling instead, so",
    "the whole family is listed here and every member is under the licence shown.",
    "",
    ...[...families.values()].flatMap(familyEntry),
  ];
}

function copyleftSection(packages, usesNextImage) {
  const copyleft = packages.filter((pkg) => COPYLEFT.test(pkg.license));
  if (copyleft.length === 0) {
    return [];
  }
  return [
    "## Copyleft dependencies",
    "",
    "Everything else here is permissive. These are not, and are called out so the",
    "distinction is not buried in the table above.",
    "",
    ...copyleft.map(bullet),
    "",
    "These arrive under `sharp`, the image encoder Next.js uses to serve",
    "`next/image`. It runs server-side and is not linked into anything sent to a",
    "browser.",
    "",
    usesNextImage
      ? "This app does import `next/image`, so that encoder is on a live path."
      : "This app imports `next/image` nowhere, checked at generation time, so " +
        "the code sits in the dependency tree without being reached.",
    "",
  ];
}

function licenceTextSection(packages) {
  const blocks = [...groupByText(packages)].flatMap(([text, group]) => [
    `### ${group[0].license}`,
    "",
    `Applies to: ${group.map((pkg) => `\`${pkg.name}\` ${pkg.version}`).join(", ")}`,
    "",
    "```",
    text,
    "```",
    "",
  ]);
  return ["## Licence texts", "", ...blocks];
}

const PREAMBLE = [
  "# Third-party notices",
  "",
  "Generated by `pnpm notices` from the installed production dependency tree.",
  "Do not edit by hand; edit `scripts/lib/notices.mjs` and regenerate.",
  "",
  "This file covers software dependencies only. The LDraw parts and models that",
  "ship in `public/` are other people's CC BY work and are covered in",
  "[LICENSE](LICENSE), which is also where this project's own licence lives.",
  "",
];

/** The whole of NOTICES.md. */
export function renderNotices({ families, packages, usesNextImage }) {
  const lines = [
    ...PREAMBLE,
    ...inventorySection(packages),
    ...missingSection(packages),
    ...platformSection(families),
    ...copyleftSection(packages, usesNextImage),
    ...licenceTextSection(packages),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
