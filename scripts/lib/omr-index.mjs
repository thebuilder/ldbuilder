// Scrape the OMR set list into something a search box can hold.
//
// The OMR has no API. The set list at library.ldraw.org/omr/sets is a Livewire
// table: 1,470 sets over 59 pages of server-rendered HTML, 25 to a page, with
// no JSON behind it and no directory listing to fall back on (that path is
// 403). So the index is scraped once, committed, and refreshed by hand when it
// drifts. New sets are added to the OMR a handful of times a year, and a set
// missing from the index still opens if its number is typed in full.
//
// Parsing HTML with regex is a bad idea in general and fine here: the table is
// four flat columns of text with no nesting, and the alternative is shipping a
// parser to read a file that changes twice a year.

const LIST_URL = "https://library.ldraw.org/omr/sets";

const USER_AGENT =
  "ldbuilder set-index builder (+https://github.com/thebuilder/ldbuilder)";

const ROW = /<tr[^>]*>(.*?)<\/tr>/gs;
const CELL = /<t[dh][^>]*>(.*?)<\/t[dh]>/gs;
const TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;
const SET_ID = /^\d{2,8}-\d{1,2}$/;
const YEAR = /^\d{4}$/;
const TOTAL = /Showing \d+ to \d+ of ([\d,]+) results/;

const ENTITIES = {
  "&#039;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
};
const ENTITY = /&(?:#0?39|amp|gt|lt|nbsp|quot);/g;

function cellText(html) {
  return html
    .replace(TAG, "")
    .replace(ENTITY, (match) => ENTITIES[match] ?? match)
    .replace(WHITESPACE, " ")
    .trim();
}

async function fetchPage(page) {
  const response = await fetch(`${LIST_URL}?page=${page}`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`${LIST_URL}?page=${page} returned ${response.status}`);
  }
  return await response.text();
}

/**
 * Pull the set rows out of one page.
 *
 * Columns are: set number, name, theme, year, file count. A row is only taken
 * when the first cell parses as a set number, which skips the header and any
 * layout rows without having to know where they are.
 */
export function parsePage(doc) {
  const sets = [];
  for (const [, row] of doc.matchAll(ROW)) {
    const cells = [...row.matchAll(CELL)]
      .map(([, cell]) => cellText(cell))
      .filter(Boolean);

    if (cells.length < 4 || !SET_ID.test(cells[0])) {
      continue;
    }
    const [setId, name, theme, year] = cells;
    sets.push({
      name,
      setId,
      theme,
      year: YEAR.test(year) ? Number(year) : null,
    });
  }
  return sets;
}

export function parseTotal(doc) {
  const match = TOTAL.exec(doc);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

/**
 * Scrape every page.
 *
 * Pages are fetched a few at a time. This is somebody's server rendering a
 * database-backed table on every request, and the whole job is 59 requests that
 * run once every few months, so there is nothing to gain by being greedy.
 *
 * @param {(message: string) => void} [onProgress]
 */
export async function fetchIndex(onProgress = () => undefined) {
  const first = await fetchPage(1);
  const total = parseTotal(first);
  const sets = parsePage(first);

  if (sets.length === 0) {
    throw new Error(
      `no rows parsed from ${LIST_URL}. The table markup has probably changed.`
    );
  }

  const pages = total ? Math.ceil(total / sets.length) : 1;
  onProgress(`${total ?? "?"} sets over ${pages} pages`);

  const BATCH = 4;
  for (let page = 2; page <= pages; page += BATCH) {
    const batch = [];
    for (let i = page; i < page + BATCH && i <= pages; i += 1) {
      batch.push(i);
    }
    // biome-ignore lint/performance/noAwaitInLoops: batches are paced on purpose, so the next one waits for this one
    const docs = await Promise.all(batch.map((n) => fetchPage(n)));
    for (const doc of docs) {
      sets.push(...parsePage(doc));
    }
    onProgress(`  ${sets.length}/${total ?? "?"}`);
  }

  return { sets, total };
}
