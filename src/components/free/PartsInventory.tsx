"use client";

import { useMemo, useState } from "react";
import { Search } from "@/components/Icon";
import type { PaletteGroup, PalettePart } from "@/ldraw/palette";
import { ColorPicker } from "./ColorPicker";
import { StudIcon } from "./StudIcon";

/** Footprints worth filtering by; past this a part is "big" and you scroll. */
const STUD_FILTERS = [1, 2, 3, 4, 6, 8];

export interface PartsInventoryProps {
  colorCode: number;
  groups: PaletteGroup[];
  onColor: (code: number) => void;
  onPin: (file: string) => void;
  onPour: (file: string, count: number) => void;
  onPourCount: (count: number) => void;
  onTake: (file: string) => void;
  pinned: string[];
  pourCount: number;
}

const POUR_COUNTS = [1, 5, 10, 25];

/** Group labels are two or three words; the tab has room for the first. */
const FIRST_WORD = /[ ,&]/;
const DAT_SUFFIX = /\.dat$/i;

/**
 * The box of parts.
 *
 * Two ways out of it, because there are two things people mean by "I want that
 * brick". **Take** puts one on the pointer to place straight away, which is how
 * you build. **Tip out** drops a handful on the floor as a physical pile, which
 * is how you get a working supply of the part you are about to use fifty of.
 */
export function PartsInventory({
  groups,
  colorCode,
  pinned,
  pourCount,
  onTake,
  onPour,
  onPin,
  onColor,
  onPourCount,
}: PartsInventoryProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [studs, setStuds] = useState<number | null>(null);
  const [allColors, setAllColors] = useState(false);

  const matches = useMemo(
    () => filterParts(groups, { group, query, studs }),
    [groups, group, query, studs]
  );

  return (
    <div className="panel pointer-events-auto flex min-h-0 flex-1 flex-col">
      <div className="border-edge border-b px-3 py-2">
        <span className="label">Parts</span>
      </div>

      <div className="shrink-0 space-y-2.5 border-edge border-b px-3 py-2.5">
        <label className="flex items-center gap-2" htmlFor="parts-search">
          <span className="text-faint">
            <Search />
          </span>
          <input
            autoComplete="off"
            className="readout w-full bg-transparent text-ink outline-none placeholder:text-faint"
            id="parts-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search parts"
            type="search"
            value={query}
          />
        </label>

        <div className="flex flex-wrap gap-px bg-edge">
          <button
            className="hud-button border-0 px-2 py-1"
            data-active={group === null}
            onClick={() => setGroup(null)}
            type="button"
          >
            All
          </button>
          {groups.map((entry) => (
            <button
              className="hud-button border-0 px-2 py-1"
              data-active={group === entry.id}
              key={entry.id}
              onClick={() => setGroup(entry.id)}
              title={entry.label}
              type="button"
            >
              {entry.label.split(FIRST_WORD)[0]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="label mr-1">Studs</span>
          <button
            className="hud-button px-2 py-0.5"
            data-active={studs === null}
            onClick={() => setStuds(null)}
            type="button"
          >
            Any
          </button>
          {STUD_FILTERS.map((count) => (
            <button
              className="hud-button px-2 py-0.5"
              data-active={studs === count}
              key={count}
              onClick={() => setStuds(count)}
              title={`Parts with a side ${count} studs across`}
              type="button"
            >
              {count}
            </button>
          ))}
        </div>

        <ColorPicker
          expanded={allColors}
          onExpand={setAllColors}
          onSelect={onColor}
          selected={colorCode}
        />

        <div className="flex items-center gap-1">
          <span className="label mr-1">Tip out</span>
          {POUR_COUNTS.map((count) => (
            <button
              className="hud-button px-2 py-0.5"
              data-active={pourCount === count}
              key={count}
              onClick={() => onPourCount(count)}
              type="button"
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="readout px-3 py-4 text-faint">
            No parts match. Try a wider filter.
          </p>
        ) : (
          <ul>
            {matches.map((part) => (
              <li
                className="flex items-center gap-2 border-edge border-b px-3 py-1.5 last:border-b-0 hover:bg-panel-raised"
                key={part.file}
              >
                <StudIcon colorCode={colorCode} size={part.size} />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onTake(part.file)}
                  title="Take one, then click in the scene to place it"
                  type="button"
                >
                  <span className="block truncate text-ink text-xs">
                    {part.name}
                  </span>
                  <span className="readout text-faint">
                    {part.file.replace(DAT_SUFFIX, "")}
                  </span>
                </button>
                <button
                  className="hud-button shrink-0 px-1.5 py-0.5"
                  onClick={() => onPour(part.file, pourCount)}
                  title={`Tip ${pourCount} onto the floor`}
                  type="button"
                >
                  +{pourCount}
                </button>
                <button
                  aria-pressed={pinned.includes(part.file)}
                  className="hud-button shrink-0 px-1.5 py-0.5"
                  data-active={pinned.includes(part.file)}
                  onClick={() => onPin(part.file)}
                  title="Keep this one on the hotbar"
                  type="button"
                >
                  ★
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="readout border-edge border-t px-3 py-1.5 text-faint">
        {matches.length} of {groups.reduce((n, g) => n + g.parts.length, 0)}
      </p>
    </div>
  );
}

interface Filters {
  group: string | null;
  query: string;
  studs: number | null;
}

function filterParts(groups: PaletteGroup[], filters: Filters): PalettePart[] {
  const needle = filters.query.trim().toLowerCase();
  const out: PalettePart[] = [];

  for (const group of groups) {
    if (filters.group !== null && group.id !== filters.group) {
      continue;
    }
    for (const part of group.parts) {
      if (filters.studs !== null && !part.size.includes(filters.studs)) {
        continue;
      }
      if (
        needle !== "" &&
        !(
          part.name.toLowerCase().includes(needle) ||
          part.file.toLowerCase().includes(needle)
        )
      ) {
        continue;
      }
      out.push(part);
    }
  }
  return out;
}
