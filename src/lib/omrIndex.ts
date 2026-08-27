// The searchable list of official sets behind the gallery's set field.
//
// public/omr-index.json is scraped from the OMR by `pnpm ldraw:index` and
// committed. It is 75KB, 19KB over the wire, so it is fetched on first use
// rather than with the page: most visitors open a bundled model and never touch
// the field.

/** One row of public/omr-index.json, whose `columns` key documents the order. */
export interface OmrSet {
  name: string;
  setId: string;
  theme: string;
  year: number | null;
}

type Row = [setId: string, name: string, theme: string, year: number | null];

const INDEX_URL = "/omr-index.json";

/** Enough to fill the list without turning it into a page of its own. */
const MAX_SUGGESTIONS = 8;

let cached: Promise<OmrSet[]> | null = null;

/**
 * Load the index, once per page.
 *
 * A failure is not worth surfacing: the field still accepts a set number typed
 * in full, which is what it did before it could suggest anything.
 */
export function loadOmrIndex(): Promise<OmrSet[]> {
  cached ??= fetch(INDEX_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`${INDEX_URL} returned ${response.status}`);
      }
      return response.json() as Promise<{ sets: Row[] }>;
    })
    .then(({ sets }) =>
      sets.map(([setId, name, theme, year]) => ({ name, setId, theme, year }))
    )
    .catch(() => []);
  return cached;
}

/** OMR ids carry a variant suffix: the `-1` in `928-1`. */
const VARIANT_SUFFIX = /-\d+$/;

/** `928-1` and `928` should both feel like the same query. */
const bareNumber = (setId: string) => setId.replace(VARIANT_SUFFIX, "");

/**
 * Rank one set against a query, or null if it does not match.
 *
 * Lower is better. The tiers matter more than the numbers: someone typing `75`
 * wants set 75-something before every Star Wars set from 75xxx, and someone
 * typing `falcon` wants the name match before the theme match.
 */
function score(set: OmrSet, query: string): number | null {
  const setId = set.setId.toLowerCase();
  const bare = bareNumber(setId);
  const name = set.name.toLowerCase();
  const theme = set.theme.toLowerCase();

  if (setId === query || bare === query) {
    return 0;
  }
  if (bare.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (name.includes(query)) {
    return 3;
  }
  if (theme.includes(query)) {
    return 4;
  }
  return null;
}

/**
 * The best few matches for a query.
 *
 * Ties break on set number so the order is stable between keystrokes; a list
 * that reshuffles under the cursor is worse than one that is slightly wrong.
 */
export function searchSets(
  sets: OmrSet[],
  rawQuery: string,
  limit = MAX_SUGGESTIONS
): OmrSet[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) {
    return [];
  }

  const scored: { set: OmrSet; rank: number }[] = [];
  for (const set of sets) {
    const rank = score(set, query);
    if (rank !== null) {
      scored.push({ rank, set });
    }
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.set.setId.localeCompare(b.set.setId, "en", { numeric: true })
  );
  return scored.slice(0, limit).map(({ set }) => set);
}
