"use client";

import { useMemo, useState } from "react";
import { colorHex, colorName, isTranslucent } from "@/ldraw/colors.generated";
import { partNumber } from "@/ldraw/mpd";
import type { BomEntry, Brick, StepInfo } from "@/ldraw/types";

export interface PartsBinProps {
  bom: BomEntry[];
  bricks: Brick[];
  hoveredKey: string | null;
  onHover: (entry: BomEntry | null) => void;
  step: number;
  steps: StepInfo[];
}

type Scope = "all" | "step";

export function PartsBin({
  bom,
  bricks,
  steps,
  step,
  hoveredKey,
  onHover,
}: PartsBinProps) {
  const [scope, setScope] = useState<Scope>("all");

  // The step scope rebuilds a small BOM from just this step's bricks, so the
  // counts show what to pick up now rather than a running total.
  const entries = useMemo(() => {
    if (scope === "all") {
      return bom;
    }

    // `step` counts finished steps, so at the end it points past the last one.
    const ids = steps[Math.min(step, steps.length - 1)]?.brickIds ?? [];
    const grouped = new Map<string, BomEntry>();
    for (const id of ids) {
      const brick = bricks[id];
      if (!brick) {
        continue;
      }
      const key = `${brick.partFile.toLowerCase()}|${brick.colorCode}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        existing.brickIds.push(id);
        continue;
      }
      grouped.set(key, {
        brickIds: [id],
        colorCode: brick.colorCode,
        count: 1,
        firstStep: brick.step,
        key,
        partFile: brick.partFile,
        partName: brick.partName,
      });
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count);
  }, [scope, bom, bricks, steps, step]);

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="panel pointer-events-auto flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-edge border-b px-3 py-2">
        <span className="label">Parts</span>
        <div className="flex gap-px bg-edge">
          <button
            className="hud-button border-0 px-2 py-1"
            data-active={scope === "all"}
            onClick={() => setScope("all")}
            type="button"
          >
            All
          </button>
          <button
            className="hud-button border-0 px-2 py-1"
            data-active={scope === "step"}
            onClick={() => setScope("step")}
            type="button"
          >
            Step
          </button>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <li className="px-3 py-4 text-faint text-xs">
            No parts in this step.
          </li>
        )}
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-panel-raised data-[active=true]:bg-panel-raised"
              data-active={hoveredKey === entry.key}
              onBlur={() => onHover(null)}
              onFocus={() => onHover(entry)}
              onMouseEnter={() => onHover(entry)}
              onMouseLeave={() => onHover(null)}
              type="button"
            >
              <Swatch code={entry.colorCode} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink text-xs">
                  {entry.partName}
                </span>
                <span className="readout block truncate text-faint">
                  {partNumber(entry.partFile)} &middot;{" "}
                  {colorName(entry.colorCode)}
                </span>
              </span>
              <span className="readout tabular shrink-0 text-muted">
                &times;{entry.count}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="readout flex justify-between border-edge border-t px-3 py-2 text-faint">
        <span>{entries.length} kinds</span>
        <span className="tabular">{total} bricks</span>
      </div>
    </div>
  );
}

function Swatch({ code }: { code: number }) {
  const translucent = isTranslucent(code);
  return (
    <span
      aria-hidden
      className="h-4 w-4 shrink-0 border border-edge-bright"
      style={{
        backgroundColor: colorHex(code),
        opacity: translucent ? 0.65 : 1,
      }}
      title={`${colorName(code)} (${code})`}
    />
  );
}
