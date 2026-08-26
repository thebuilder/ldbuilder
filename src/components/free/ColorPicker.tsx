"use client";

import {
  colorHex,
  colorName,
  hasColor,
  isTranslucent,
} from "@/ldraw/colors.generated";

/**
 * The colours worth offering.
 *
 * The library defines 322, most of which are a specific year's pearl finish or
 * a licensed skin tone. These are the ones a tub of bricks actually comes in,
 * listed by code so the names and values still come from the generated table
 * rather than being written down twice.
 */
const SOLID = [
  15, 0, 71, 72, 7, 8, 4, 25, 14, 2, 10, 1, 73, 9, 22, 26, 13, 5, 6, 70, 19, 28,
  27, 3, 11, 17, 18, 12, 29, 30, 31, 85, 92, 78,
];

const TRANSLUCENT = [47, 40, 36, 57, 46, 42, 34, 43, 33, 41, 37, 52];

/** Chrome and pearl, which a builder reaches for last but does reach for. */
const FINISH = [80, 82, 83, 84, 135, 179, 148];

const SECTIONS = [
  { codes: SOLID, id: "solid", label: "Solid" },
  { codes: TRANSLUCENT, id: "trans", label: "Translucent" },
  { codes: FINISH, id: "finish", label: "Metallic" },
];

/** The row that shows without asking: what most builds are actually made of. */
const FAVOURITES = [15, 71, 72, 0, 4, 25, 14, 2, 1, 73, 70, 19];

export interface ColorPickerProps {
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  onSelect: (code: number) => void;
  selected: number;
}

/**
 * Colour, in one row until you want more.
 *
 * Fifty swatches is a wall, and it was pushing the part list off the bottom of
 * the panel. The dozen a build is usually made of sit out; the rest are one
 * press away.
 */
export function ColorPicker({
  selected,
  expanded,
  onSelect,
  onExpand,
}: ColorPickerProps) {
  if (!expanded) {
    const codes = FAVOURITES.filter(hasColor);
    const shown = codes.includes(selected) ? codes : [selected, ...codes];
    return (
      <div className="flex items-center gap-1">
        <span className="label mr-1">Colour</span>
        <div className="flex flex-wrap gap-1">
          {shown.map((code) => (
            <Swatch
              code={code}
              key={code}
              onSelect={onSelect}
              selected={selected}
            />
          ))}
        </div>
        <button
          className="hud-button ml-auto px-1.5 py-0.5"
          onClick={() => onExpand(true)}
          title="Every colour"
          type="button"
        >
          More
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">Colour</span>
        <button
          className="hud-button px-1.5 py-0.5"
          onClick={() => onExpand(false)}
          type="button"
        >
          Fewer
        </button>
      </div>
      {SECTIONS.map((section) => {
        const codes = section.codes.filter(hasColor);
        if (codes.length === 0) {
          return null;
        }
        return (
          <div key={section.id}>
            <p className="label mb-1">{section.label}</p>
            <div className="flex flex-wrap gap-1">
              {codes.map((code) => (
                <Swatch
                  code={code}
                  key={code}
                  onSelect={onSelect}
                  selected={selected}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Swatch({
  code,
  selected,
  onSelect,
}: {
  code: number;
  selected: number;
  onSelect: (code: number) => void;
}) {
  return (
    <button
      aria-label={colorName(code)}
      aria-pressed={selected === code}
      className="h-5 w-5 shrink-0 border transition-[outline] focus-visible:outline"
      onClick={() => onSelect(code)}
      style={{
        backgroundColor: colorHex(code),
        // A translucent brick is see-through, and a swatch that does not say so
        // sends you looking for a colour you already have.
        opacity: isTranslucent(code) ? 0.6 : 1,
        outline:
          selected === code
            ? "2px solid var(--color-accent-fg)"
            : "1px solid var(--color-edge)",
        outlineOffset: selected === code ? "1px" : "0",
      }}
      title={`${colorName(code)} (${code})`}
      type="button"
    />
  );
}
