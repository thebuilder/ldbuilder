import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIndex, parsePage, parseTotal } from "./omr-index.mjs";

const NO_ROWS = /no rows parsed/;
const SERVER_ERROR = /500/;

/**
 * Two rows lifted verbatim from library.ldraw.org/omr/sets, minus the Livewire
 * conditional-comment wrappers that carry no data.
 *
 * The parser reads HTML with regex, which is only safe because the table is
 * four flat columns of text. A fixture of the real markup is what makes that
 * bet checkable: if the table gains nesting, these stop passing.
 */
const fixture = await readFile(
  path.join(import.meta.dirname, "__fixtures__/omr-set-list.html"),
  "utf8"
);

describe("parsePage", () => {
  it("pulls the set rows out of the real markup", () => {
    expect(parsePage(fixture)).toEqual([
      { name: "Metroliner", setId: "10001-1", theme: "Train", year: 2001 },
      {
        name: "Railroad Club Car",
        setId: "10002-1",
        theme: "Train",
        year: 2001,
      },
    ]);
  });

  it("skips rows whose first cell is not a set number", () => {
    // The header row and any layout rows go through the same loop.
    const withHeader = `<table><tr><th>Set</th><th>Name</th><th>Theme</th><th>Year</th></tr>${fixture}</table>`;

    expect(parsePage(withHeader)).toHaveLength(2);
  });

  it("decodes the entities themes are full of", () => {
    const row = row4("10013-1", "Open Freight Wagon", "Train &gt; 9V", "2001");

    expect(parsePage(row)[0].theme).toBe("Train > 9V");
  });

  it("decodes an apostrophe in a set name", () => {
    const row = row4(
      "6074-1",
      "Black Falcon&#039;s Fortress",
      "Castle",
      "1986"
    );

    expect(parsePage(row)[0].name).toBe("Black Falcon's Fortress");
  });

  it("keeps a long set number, which promotional sets have", () => {
    const row = row4("4002020-1", "Celebrating 40 Years", "Exclusive", "2020");

    expect(parsePage(row)[0].setId).toBe("4002020-1");
  });

  it("returns null rather than NaN for an unparseable year", () => {
    const row = row4("123-1", "Thing", "Town", "n/a");

    expect(parsePage(row)[0].year).toBeNull();
  });

  it("returns nothing for a page with no table at all", () => {
    // An error page or a redirect must not look like an empty set list; the
    // scraper checks its total against this to refuse a short index.
    expect(parsePage("<html><body>Forbidden</body></html>")).toEqual([]);
  });
});

describe("parseTotal", () => {
  it("reads the count out of the results line", () => {
    expect(parseTotal(fixture)).toBe(1470);
  });

  it("handles a thousands separator", () => {
    expect(parseTotal("Showing 1 to 25 of 12,345 results")).toBe(12_345);
  });

  it("returns null when the line is absent", () => {
    expect(parseTotal("<html></html>")).toBeNull();
  });
});

/** One table row of four cells, in the order the OMR renders them. */
function row4(setId, name, theme, year) {
  return `<table><tr><td>${setId}</td><td>${name}</td><td>${theme}</td><td>${year}</td><td>1</td></tr></table>`;
}

/** A results line plus `count` rows, as one page of the set list. */
function page(total, ids) {
  const rows = ids
    .map(
      (id) =>
        `<tr><td>${id}</td><td>Set ${id}</td><td>Town</td><td>1990</td><td>1</td></tr>`
    )
    .join("");
  return `<table>${rows}</table><p>Showing 1 to 25 of ${total} results</p>`;
}

/** Serve `pages` in order, keyed by the ?page= number in the URL. */
function serve(pages) {
  return vi.fn((url) => {
    const number = Number(new URL(url).searchParams.get("page") ?? 1);
    const body = pages[number - 1];
    return Promise.resolve(
      body === undefined
        ? new Response("", { status: 404 })
        : new Response(body, { status: 200 })
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchIndex", () => {
  it("walks every page and returns the sets in order", async () => {
    vi.stubGlobal(
      "fetch",
      serve([page(4, ["101-1", "102-1"]), page(4, ["103-1", "104-1"])])
    );

    const { sets, total } = await fetchIndex();

    expect(total).toBe(4);
    expect(sets.map((s) => s.setId)).toEqual([
      "101-1",
      "102-1",
      "103-1",
      "104-1",
    ]);
  });

  it("works out the page count from the total and the first page size", async () => {
    const fetchImpl = serve([
      page(4, ["101-1", "102-1"]),
      page(4, ["103-1", "104-1"]),
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    await fetchIndex();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops at one page when everything fits on it", async () => {
    const fetchImpl = serve([page(2, ["101-1", "102-1"])]);
    vi.stubGlobal("fetch", fetchImpl);

    await fetchIndex();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when the first page has no rows at all", async () => {
    // An error page or a changed table must fail loudly. Returning an empty
    // index would quietly ship a search box that finds nothing.
    vi.stubGlobal("fetch", serve(["<html>Forbidden</html>"]));

    await expect(fetchIndex()).rejects.toThrow(NO_ROWS);
  });

  it("throws when a page request fails", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("", { status: 500 }))
    );

    await expect(fetchIndex()).rejects.toThrow(SERVER_ERROR);
  });

  it("reports progress, since the scrape takes a few seconds", async () => {
    vi.stubGlobal(
      "fetch",
      serve([page(4, ["101-1", "102-1"]), page(4, ["103-1", "104-1"])])
    );
    const messages = [];

    await fetchIndex((message) => messages.push(message));

    expect(messages[0]).toContain("4 sets");
  });
});
