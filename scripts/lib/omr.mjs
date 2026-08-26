// Fetch models from the LDraw Official Model Repository.
//
// The OMR is LDraw.org's own collection of official LEGO sets, about 1,470 of
// them, each built and submitted by a named author. It matters here for one
// reason above all: every file carries
//
//   0 !LICENSE Redistributable under CCAL version 2.0
//
// the same Creative Commons Attribution licence as the parts library. Community
// recreations found elsewhere carry no stated licence at all, which is why none
// are committed to this repo. OMR sets can be, provided the author is credited,
// which is what `readMetadata` below is for.
//
// Downloads land in .cache/omr so a re-pack does not refetch. The packed output
// in public/models is what ships.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./paths.mjs";

const OMR_FILE_URL = "https://library.ldraw.org/library/omr";
const OMR_SET_PAGE = "https://library.ldraw.org/omr/sets";

const OMR_CACHE = path.join(CACHE_DIR, "omr");

const AUTHOR = /^0\s+Author:\s*(.+)$/im;
const THEME = /^0\s+!THEME\s+(.+)$/im;
const CATEGORY = /^0\s+!CATEGORY\s+(.+)$/im;
const KEYWORDS = /^0\s+!KEYWORDS\s+(.+)$/im;
const LICENSE = /^0\s+!LICENSE\s+(.+)$/im;
const REDISTRIBUTABLE = /CCAL/i;
/** OMR set ids carry a variant suffix: `928-1`. */
const HAS_VARIANT = /-\d+$/;

/**
 * OMR set ids look like `928-1`: the set number, then the variant. A bare
 * number is the common case and gets the default variant.
 */
export function normalizeSetId(id) {
  const trimmed = String(id).trim();
  return HAS_VARIANT.test(trimmed) ? trimmed : `${trimmed}-1`;
}

/** Read the attribution the CCAL licence requires, plus what the gallery shows. */
function readMetadata(text) {
  const license = LICENSE.exec(text)?.[1]?.trim() ?? null;
  return {
    author: AUTHOR.exec(text)?.[1]?.trim() ?? null,
    keywords: KEYWORDS.exec(text)?.[1]?.trim() ?? null,
    license,
    // A file without the CCAL header must not be redistributed, so the caller
    // can refuse rather than commit something it has no licence for.
    redistributable: license !== null && REDISTRIBUTABLE.test(license),
    theme: (THEME.exec(text) ?? CATEGORY.exec(text))?.[1]?.trim() ?? null,
  };
}

/**
 * Fetch one OMR set, caching the download.
 *
 * @returns {Promise<{ setId: string, text: string, metadata: object }>}
 */
export async function fetchSet(id) {
  const setId = normalizeSetId(id);
  const cached = path.join(OMR_CACHE, `${setId}.mpd`);

  let text;
  try {
    text = await readFile(cached, "utf8");
  } catch (cacheMiss) {
    const url = `${OMR_FILE_URL}/${setId}.mpd`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? `set ${setId} is not in the OMR. Browse ${OMR_SET_PAGE} for what is.`
          : `could not fetch ${url} (${response.status})`,
        { cause: cacheMiss }
      );
    }
    text = await response.text();
    await mkdir(OMR_CACHE, { recursive: true });
    await writeFile(cached, text);
  }

  return { metadata: readMetadata(text), setId, text };
}
