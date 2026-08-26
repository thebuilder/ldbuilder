"use client";

import { colorHex, colorName } from "@/ldraw/colors.generated";
import type { PalettePart } from "@/ldraw/palette";
import { StudIcon } from "./StudIcon";

export interface HotbarSlot {
  colorCode: number;
  file: string;
}

export interface HotbarProps {
  active: number | null;
  byFile: Map<string, PalettePart>;
  onClear: (index: number) => void;
  onSelect: (index: number) => void;
  slots: (HotbarSlot | null)[];
}

/**
 * Nine slots along the bottom, on the number keys.
 *
 * A build uses five or six parts over and over and the inventory holds two
 * hundred, so the hotbar is the difference between building and searching. It
 * remembers the colour as well as the part, because "red 2x4" and "black 2x4"
 * are two different things to reach for.
 */
export function Hotbar({
  slots,
  active,
  byFile,
  onSelect,
  onClear,
}: HotbarProps) {
  return (
    <div className="panel pointer-events-auto flex items-center gap-1 px-2 py-2">
      {slots.map((slot, index) => {
        const part = slot ? byFile.get(slot.file.toLowerCase()) : undefined;
        const key = `slot-${index}`;
        return (
          <div className="relative" key={key}>
            <button
              className="hud-button h-12 w-12 flex-col gap-0.5 px-0"
              data-active={active === index}
              onClick={() => onSelect(index)}
              title={
                part && slot
                  ? `${part.name} in ${colorName(slot.colorCode)}`
                  : `Slot ${index + 1}: pin a part from the inventory`
              }
              type="button"
            >
              {part && slot ? (
                <StudIcon colorCode={slot.colorCode} size={part.size} />
              ) : (
                <span
                  aria-hidden
                  className="h-5 w-5 border border-edge border-dashed"
                />
              )}
              <span className="readout text-[9px] text-faint">{index + 1}</span>
            </button>
            {slot ? (
              <button
                aria-label={`Clear slot ${index + 1}`}
                className="absolute -top-1 -right-1 h-4 w-4 border border-edge bg-panel text-faint text-xs leading-none hover:text-ink"
                onClick={() => onClear(index)}
                style={{ borderColor: colorHex(slot.colorCode) }}
                title="Clear this slot"
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
