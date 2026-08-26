// Packs an LDraw model plus every part it references into a single .mpd file.
//
// Why this exists: a .ldr is just a list of transforms pointing at part files in
// the 20k-file official library. Serving that library over HTTP means hundreds of
// requests per model, most of them 404s, because LDrawLoader resolves parts by
// trying parts/ then p/ then models/ in turn. Packing collapses a model to one
// request and removes the library from the runtime entirely.
//
// The subtle part is naming. LDrawLoader normalizes every reference before it
// looks it up (LDrawLoader.js, LDrawParsedCache.parse / fetchData):
//
//   backslashes -> forward slashes
//   "s/foo.dat"  -> "parts/s/foo.dat"
//   "48/foo.dat" -> "p/48/foo.dat"
//   anything else is left alone, then searched as parts/X, p/X, models/X
//
// and the embedded-file cache is keyed on the lowercased result. So the name we
// write into each "0 FILE" header must be the *normalized reference string*, not
// the path the file happens to live at on disk. `3001.dat` lives at
// `parts/3001.dat` but must be emitted as `0 FILE 3001.dat`, or the loader will
// never find it and will silently render nothing for that brick.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Directories searched, in the order LDrawLoader itself searches them. */
const SEARCH_DIRS = ["parts", "p", "models"];

/** A type-1 line is: 1 <colour> x y z a b c d e f g h i <file> */
const REF_LINE = /^1\s+\S+(?:\s+\S+){12}\s+(.+)$/;
const LINE_BREAK = /\r\n|\r|\n/;
const FILE_DIRECTIVE = /^0\s+FILE\s+(.+)$/i;
const TEXMAP_DIRECTIVE = /^0\s+!TEXMAP/i;
const LIBRARY_EXTENSION = /\.(dat|ldr|mpd)$/i;
const MOVED_TO = /^~Moved to\s+(\S+)/i;
/** Leading ~, = or _ mark a part as an alias or otherwise not a real part. */
const ALIAS_MARKERS = /^[~=_]+/;

/**
 * Normalize a reference exactly the way LDrawLoader does, so our emitted
 * `0 FILE` names line up with the keys it will look up.
 */
export function normalizeRef(ref) {
  const name = ref.trim().replace(/\\/g, "/");
  if (name.startsWith("s/")) {
    return `parts/${name}`;
  }
  if (name.startsWith("48/")) {
    return `p/${name}`;
  }
  return name;
}

const splitLines = (text) => text.split(LINE_BREAK);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, out);
      } else {
        out.push(full);
      }
    })
  );
  return out;
}

/**
 * Build a lookup from normalized reference name -> absolute path on disk.
 *
 * `parts/` wins over `p/` wins over `models/`, mirroring the loader's own
 * precedence, so a name present in two trees resolves the same way at runtime.
 */
export async function buildLibraryIndex(libraryDir) {
  const index = new Map();
  const collisions = [];

  for (const dir of SEARCH_DIRS) {
    // turbopackIgnore keeps the bundler from tracing the parts library into
    // the server output when this module is shared with the /api/pack route.
    const root = path.join(/* turbopackIgnore: true */ libraryDir, dir);
    for (const file of await walk(root)) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (!LIBRARY_EXTENSION.test(rel)) {
        continue;
      }

      // A file is cited by its path relative to the search dir, then run
      // through the loader's normalization. That handles all four shapes at
      // once: `3001.dat` -> `3001.dat`, `s/x.dat` -> `parts/s/x.dat`,
      // `48/x.dat` -> `p/48/x.dat`, and `8/x.dat` -> `8/x.dat` (the loader
      // rewrites `48/` but not `8/`, and finds the latter via its p/ search).
      const key = normalizeRef(rel).toLowerCase();

      if (index.has(key)) {
        collisions.push(key);
        continue; // first tree wins, matching loader precedence
      }
      index.set(key, file);
    }
  }
  return { collisions, index };
}

/**
 * Follow `~Moved to` redirects so the parts bin shows a real name.
 *
 * LDraw keeps retired part numbers alive as one-line stubs whose description is
 * literally "~Moved to 3023b". Those still render correctly, because the stub
 * references its replacement, but showing "~Moved to 3023b" in an inventory is
 * useless. Leading ~ = ~ and = markers flag non-real or alias parts and are
 * noise once the redirect is resolved.
 */
function resolveAliasNames(partNames) {
  for (const key of Object.keys(partNames)) {
    let name = partNames[key];
    const seen = new Set([key]);

    let match = MOVED_TO.exec(name);
    while (match) {
      let target = normalizeRef(match[1]).toLowerCase();
      if (!target.endsWith(".dat")) {
        target += ".dat";
      }
      if (seen.has(target) || partNames[target] === undefined) {
        break;
      }
      seen.add(target);
      name = partNames[target];
      match = MOVED_TO.exec(name);
    }

    partNames[key] = name.replace(ALIAS_MARKERS, "").trim();
  }
}

/** First plain `0 ...` line of a part file is its human description. */
function descriptionOf(text) {
  for (const line of splitLines(text)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    if (!t.startsWith("0 ")) {
      return null;
    }
    const desc = t.slice(2).trim();
    return desc.startsWith("!") || desc.startsWith("//") ? null : desc;
  }
  return null;
}

/** Split an .mpd into its `0 FILE <name>` blocks, preserving order. */
function extractEmbedded(text) {
  const blocks = new Map();
  let current = null;
  let buffer = [];
  for (const line of splitLines(text)) {
    const match = FILE_DIRECTIVE.exec(line.trim());
    if (match) {
      if (current !== null) {
        blocks.set(current, buffer.join("\n"));
      }
      current = normalizeRef(match[1]).toLowerCase();
      buffer = [];
      continue;
    }
    if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) {
    blocks.set(current, buffer.join("\n"));
  }
  return blocks;
}

/** Every part reference in a file body, normalized. */
function refsIn(body) {
  const refs = [];
  const texmaps = [];
  for (const rawLine of splitLines(body)) {
    const line = rawLine.trim();
    if (TEXMAP_DIRECTIVE.test(line)) {
      texmaps.push(line);
      continue;
    }
    const match = REF_LINE.exec(line);
    if (match) {
      refs.push(normalizeRef(match[1]));
    }
  }
  return { refs, texmaps };
}

/**
 * Pack `text` and all of its dependencies into one self-contained .mpd.
 *
 * @param {object} opts
 * @param {string} opts.text  Raw .ldr or .mpd source.
 * @param {string} opts.name  Name for the root model block.
 * @param {Map<string,string>} opts.index  From buildLibraryIndex().
 * @param {boolean} [opts.skipMissing]  Drop references that cannot be resolved
 *   instead of leaving them in. The rest of the model still builds; without
 *   this the caller is expected to treat `missing` as a failure.
 * @returns {Promise<{mpd:string, partNames:Record<string,string>, missing:string[], stats:object}>}
 */
export async function packModel({ text, name, index, skipMissing = false }) {
  const embedded = extractEmbedded(text);
  const isMpd = embedded.size > 0;

  const rootName = normalizeRef(name);
  const rootKey = rootName.toLowerCase();

  // Bodies to emit, keyed by normalized lowercase name. Subfiles that arrived
  // embedded in an .mpd are seeded here so we never try to resolve them from
  // the library, but they still get scanned for their own dependencies.
  const bodies = new Map();
  const partNames = {};
  const missing = new Set();
  const texmapFiles = new Set();

  let rootBody = text;
  if (isMpd) {
    const keys = [...embedded.keys()];
    rootBody = embedded.get(keys[0]);
    for (const key of keys.slice(1)) {
      bodies.set(key, embedded.get(key));
    }
  }

  const scanned = new Set();
  const queue = [];

  function enqueueFrom(key, body) {
    if (scanned.has(key)) {
      return;
    }
    scanned.add(key);
    const { refs, texmaps } = refsIn(body);
    if (texmaps.length > 0) {
      texmapFiles.add(key);
    }
    queue.push(...refs);
  }

  enqueueFrom(rootKey, rootBody);
  for (const [key, body] of bodies) {
    const desc = descriptionOf(body);
    if (desc) {
      partNames[key] = desc;
    }
    enqueueFrom(key, body);
  }

  while (queue.length > 0) {
    const ref = queue.shift();
    const key = ref.toLowerCase();
    if (scanned.has(key)) {
      continue;
    }

    if (bodies.has(key)) {
      enqueueFrom(key, bodies.get(key));
      continue;
    }

    const diskPath = index.get(key);
    if (!diskPath) {
      missing.add(ref);
      scanned.add(key); // do not report the same missing part once per reference
      continue;
    }

    // biome-ignore lint/performance/noAwaitInLoops: the queue grows as each file is parsed, so the next reference is only known once this read finishes
    const body = await readFile(diskPath, "utf8");
    bodies.set(key, body);
    const desc = descriptionOf(body);
    if (desc) {
      partNames[key] = desc;
    }
    enqueueFrom(key, body);
  }

  resolveAliasNames(partNames);

  // An unresolved reference left in the output makes the loader reach for the
  // parts library at runtime, which is not there, costing six failed HTTP
  // requests per part before it gives up. Dropping the line is both faster and
  // what "build the rest of it" has to mean.
  const missingKeys = new Set([...missing].map((ref) => ref.toLowerCase()));
  let skipped = 0;
  const emit = (body) => {
    if (!skipMissing || missingKeys.size === 0) {
      return body.trimEnd();
    }
    const kept = [];
    for (const line of splitLines(body)) {
      const match = REF_LINE.exec(line.trim());
      if (match && missingKeys.has(normalizeRef(match[1]).toLowerCase())) {
        skipped += 1;
        continue;
      }
      kept.push(line);
    }
    return kept.join("\n").trimEnd();
  };

  const chunks = [`0 FILE ${rootName}`, emit(rootBody), ""];
  for (const [key, body] of bodies) {
    chunks.push(`0 FILE ${key}`, emit(body), "");
  }
  const mpd = chunks.join("\n");

  return {
    missing: [...missing],
    mpd,
    partNames,
    stats: {
      bytes: mpd.length,
      files: bodies.size + 1,
      /** Reference lines dropped because their part could not be resolved. */
      skipped,
      texmapFiles: [...texmapFiles],
    },
  };
}
