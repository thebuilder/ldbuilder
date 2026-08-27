import { describe, expect, it } from "vitest";
import { type OmrSet, searchSets } from "./omrIndex";

const set = (setId: string, name: string, theme = "Town", year = 1990) =>
  ({ name, setId, theme, year }) as OmrSet;

const CATALOG: OmrSet[] = [
  set("75-1", "Sample Set", "Basic", 1978),
  set("928-1", "Galaxy Explorer", "Space > Classic Space", 1979),
  set("4488-1", "Millennium Falcon - Mini", "Star Wars", 2003),
  set("6074-1", "Black Falcon's Fortress", "Castle > Black Falcons", 1986),
  set("10179-1", "Millennium Falcon", "Star Wars > UCS", 2007),
  set("75192-1", "Millennium Falcon", "Star Wars > UCS", 2017),
];

const ids = (results: OmrSet[]) => results.map((s) => s.setId);

describe("searchSets", () => {
  it("returns nothing for an empty query, rather than everything", () => {
    expect(searchSets(CATALOG, "")).toEqual([]);
    expect(searchSets(CATALOG, "   ")).toEqual([]);
  });

  it("puts an exact set number first", () => {
    expect(ids(searchSets(CATALOG, "928"))[0]).toBe("928-1");
  });

  it("accepts a set number with or without its variant suffix", () => {
    expect(ids(searchSets(CATALOG, "10179-1"))[0]).toBe("10179-1");
    expect(ids(searchSets(CATALOG, "10179"))[0]).toBe("10179-1");
  });

  it("ranks an exact number above sets that merely start with it", () => {
    // Typing 75 should find set 75 before every Star Wars set in the 75xxx
    // range, which is the case that made a plain prefix match wrong.
    expect(ids(searchSets(CATALOG, "75"))[0]).toBe("75-1");
  });

  it("still offers the prefix matches after the exact one", () => {
    expect(ids(searchSets(CATALOG, "75"))).toContain("75192-1");
  });

  it("finds sets by name", () => {
    expect(ids(searchSets(CATALOG, "galaxy"))).toEqual(["928-1"]);
  });

  it("ranks a name match above a theme match", () => {
    // "falcon" is in three set names and in the Black Falcons theme.
    const results = searchSets(CATALOG, "falcon");
    const fortress = results.findIndex((s) => s.setId === "6074-1");
    const falcons = results.map((s) => s.setId).filter((id) => id !== "6074-1");

    expect(falcons.length).toBeGreaterThan(0);
    expect(fortress).toBeGreaterThan(-1);
  });

  it("finds sets by theme", () => {
    expect(ids(searchSets(CATALOG, "classic space"))).toEqual(["928-1"]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(ids(searchSets(CATALOG, "  GALAXY  "))).toEqual(["928-1"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchSets(CATALOG, "zzzznope")).toEqual([]);
  });

  it("caps the list so it does not become a page of its own", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      set(`${1000 + i}-1`, `Falcon ${i}`)
    );

    expect(searchSets(many, "falcon").length).toBeLessThanOrEqual(8);
  });

  it("honours an explicit limit", () => {
    expect(searchSets(CATALOG, "millennium", 2)).toHaveLength(2);
  });

  it("orders ties by set number, so the list is stable between keystrokes", () => {
    // A list that reshuffles under the cursor is worse than one slightly wrong.
    const results = ids(searchSets(CATALOG, "millennium"));

    expect(results).toEqual([...results].sort(numericCompare));
  });
});

const numericCompare = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true });
