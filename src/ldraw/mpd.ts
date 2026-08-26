/**
 * Browser-safe LDraw text helpers.
 *
 * These mirror the rules in scripts/lib/ldraw-pack.mjs. The duplication is
 * deliberate: the script runs in Node against the on-disk parts library, while
 * this runs in the browser to decide whether a dropped file even needs the
 * server. Keeping them as one module would drag Node's fs into the client bundle.
 */

const REF_LINE = /^1\s+\S+(?:\s+\S+){12}\s+(.+)$/;
const LINE_BREAK = /\r\n|\r|\n/;
const FILE_DIRECTIVE = /^0\s+FILE\s+(.+)$/i;
const MOVED_TO = /^~Moved to\s+(\S+)/i;
/** Leading ~, = or _ mark a part as an alias or otherwise not a real part. */
const ALIAS_MARKERS = /^[~=_]+/;
const MODEL_EXTENSION = /\.(ldr|mpd|dat)$/i;
const PART_EXTENSION = /\.dat$/i;

const splitLines = (text: string): string[] => text.split(LINE_BREAK);

/** Normalize a reference the way LDrawLoader does before it looks it up. */
function normalizeRef(ref: string): string {
  const name = ref.trim().replace(/\\/g, "/");
  if (name.startsWith("s/")) {
    return `parts/${name}`;
  }
  if (name.startsWith("48/")) {
    return `p/${name}`;
  }
  return name;
}

/** Names of the `0 FILE` blocks in an .mpd, lowercased. */
function embeddedFileNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of splitLines(text)) {
    const match = FILE_DIRECTIVE.exec(line.trim());
    if (match) {
      names.add(normalizeRef(match[1]).toLowerCase());
    }
  }
  return names;
}

/** Every part reference in the file, normalized and lowercased. */
function referencedFiles(text: string): Set<string> {
  const refs = new Set<string>();
  for (const line of splitLines(text)) {
    const match = REF_LINE.exec(line.trim());
    if (match) {
      refs.add(normalizeRef(match[1]).toLowerCase());
    }
  }
  return refs;
}

/**
 * True when every reference resolves to a block inside the file itself, so the
 * loader will never reach for the parts library. Already-packed .mpd files load
 * straight from the browser with no server round trip.
 */
export function isSelfContained(text: string): boolean {
  const provided = embeddedFileNames(text);
  if (provided.size === 0) {
    return false;
  }
  for (const ref of referencedFiles(text)) {
    if (!provided.has(ref)) {
      return false;
    }
  }
  return true;
}

/** Descriptions for the parts bin, harvested from each embedded block. */
export function partNamesFromMpd(text: string): Record<string, string> {
  const names: Record<string, string> = {};
  let current: string | null = null;
  let expectDescription = false;

  for (const raw of splitLines(text)) {
    const line = raw.trim();
    const fileMatch = FILE_DIRECTIVE.exec(line);
    if (fileMatch) {
      current = normalizeRef(fileMatch[1]).toLowerCase();
      expectDescription = true;
      continue;
    }
    if (!expectDescription || current === null || line === "") {
      continue;
    }

    expectDescription = false;
    if (!line.startsWith("0 ")) {
      continue;
    }
    const description = line.slice(2).trim();
    if (
      description &&
      !description.startsWith("!") &&
      !description.startsWith("//")
    ) {
      names[current] = description;
    }
  }
  resolveAliasNames(names);
  return names;
}

/**
 * Follow `~Moved to` redirects so the parts bin shows a real name.
 *
 * LDraw keeps retired part numbers alive as one-line stubs whose description is
 * literally "~Moved to 3023b". They render correctly, because the stub
 * references its replacement, but that string is useless in an inventory. The
 * leading ~ = and _ markers flag non-real or alias parts and are noise once the
 * redirect is resolved. Mirrors resolveAliasNames in scripts/lib/ldraw-pack.mjs.
 */
function resolveAliasNames(names: Record<string, string>): void {
  for (const key of Object.keys(names)) {
    let name = names[key];
    const seen = new Set([key]);

    let match = MOVED_TO.exec(name);
    while (match) {
      let target = normalizeRef(match[1]).toLowerCase();
      if (!target.endsWith(".dat")) {
        target += ".dat";
      }
      if (seen.has(target) || names[target] === undefined) {
        break;
      }
      seen.add(target);
      name = names[target];
      match = MOVED_TO.exec(name);
    }

    names[key] = name.replace(ALIAS_MARKERS, "").trim();
  }
}

export function slugFromFileName(name: string): string {
  return (
    name
      .replace(MODEL_EXTENSION, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "model"
  );
}

/** Display form of a part file: `3001.dat` becomes `3001`. */
export function partNumber(file: string): string {
  return file.replace(PART_EXTENSION, "");
}

/** Display form of a model or submodel file, without its extension. */
export function modelName(file: string): string {
  return file.replace(MODEL_EXTENSION, "");
}
