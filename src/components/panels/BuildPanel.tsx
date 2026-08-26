"use client";

import { useMemo } from "react";
import { Restart, Target } from "@/components/Icon";
import { colorName } from "@/ldraw/colors.generated";
import type { Brick, BuildProgress } from "@/ldraw/types";

export interface BuildPanelProps {
  bricks: Brick[];
  /** The bill-of-materials key being highlighted, `*` for all, or null. */
  hint: string | null;
  onHint: (hint: string | null) => void;
  onReset: () => void;
  progress: BuildProgress;
  totalBricks: number;
}

interface NeededRow {
  colorCode: number;
  count: number;
  key: string;
  partName: string;
}

/**
 * What the step still needs, and how far in you are.
 *
 * The list is the useful half. Build mode asks you to find a piece in a heap of
 * a hundred, and a heap of a hundred is only searchable if you know what you
 * are looking for. Naming the part and its colour does most of that; hovering a
 * row lights every matching brick on the floor, which does the rest.
 */
export function BuildPanel({
  progress,
  bricks,
  totalBricks,
  hint,
  onHint,
  onReset,
}: BuildPanelProps) {
  const needed = useMemo(
    () => groupPending(progress.pending, bricks),
    [progress.pending, bricks]
  );

  const fraction = totalBricks === 0 ? 0 : progress.placedTotal / totalBricks;

  return (
    <div className="panel pointer-events-auto px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="readout text-ink">
          {progress.done ? (
            "Finished"
          ) : (
            <>
              Step <span className="tabular">{progress.step + 1}</span>
              <span className="text-faint"> / {progress.totalSteps}</span>
            </>
          )}
          {progress.totalBags > 1 && !progress.done ? (
            <span className="ml-3 text-muted">
              Bag <span className="tabular text-ink">{progress.bag + 1}</span>
              <span className="text-faint"> / {progress.totalBags}</span>
            </span>
          ) : null}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            className="hud-button px-2"
            data-active={hint === "*"}
            disabled={progress.done}
            onClick={() => onHint(hint === "*" ? null : "*")}
            title="Light up every brick this step still needs"
            type="button"
          >
            <Target />
            Find
          </button>
          <button
            className="hud-button px-2"
            onClick={onReset}
            title="Throw the build away and start again"
            type="button"
          >
            <Restart />
            Start over
          </button>
        </div>
      </div>

      <div className="mt-2.5 h-0.5 w-full bg-edge-bright">
        <div
          className="h-full bg-accent-fg transition-[width] duration-300"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        {progress.done ? (
          <p className="readout text-muted">
            Every brick is in. {totalBricks.toLocaleString()} of them.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
            {needed.map((row) => (
              <li key={row.key}>
                <button
                  className="readout flex items-baseline gap-1.5 text-left hover:text-ink"
                  onClick={() => onHint(hint === row.key ? null : row.key)}
                  onPointerEnter={() => hint === null && onHint(row.key)}
                  onPointerLeave={() => hint === row.key && onHint(null)}
                  type="button"
                >
                  <span
                    className={
                      hint === row.key
                        ? "tabular text-accent-fg"
                        : "tabular text-ink"
                    }
                  >
                    {row.count}&times;
                  </span>
                  <span className="text-muted">{row.partName}</span>
                  <span className="text-faint">{colorName(row.colorCode)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="readout ml-auto shrink-0 text-faint">
          <span className="tabular">
            {progress.placedTotal.toLocaleString()}
          </span>
          {" / "}
          <span className="tabular">{totalBricks.toLocaleString()}</span> placed
          {progress.loose > 0 ? (
            <>
              {" · "}
              <span className="tabular">{progress.loose}</span> on the floor
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/**
 * Pending slots, collapsed to one row per part and colour.
 *
 * Four identical plates are one thing to go and find, not four, and any of them
 * fills any of the slots.
 */
function groupPending(pending: number[], bricks: Brick[]): NeededRow[] {
  const rows = new Map<string, NeededRow>();

  for (const id of pending) {
    const brick = bricks[id];
    if (!brick) {
      continue;
    }
    const key = `${brick.partFile.toLowerCase()}|${brick.colorCode}`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    rows.set(key, {
      colorCode: brick.colorCode,
      count: 1,
      key,
      partName: brick.partName,
    });
  }

  return [...rows.values()].sort(
    (a, b) => b.count - a.count || a.partName.localeCompare(b.partName)
  );
}
