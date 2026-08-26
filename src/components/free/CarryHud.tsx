"use client";

import { colorName } from "@/ldraw/colors.generated";
import type { CarriedInfo } from "@/scene/FreeController";

export interface CarryHudProps {
  carrying: CarriedInfo | null;
  loose: number;
  placed: number;
}

const KEYS: { keys: string; what: string }[] = [
  { keys: "R", what: "Turn" },
  { keys: "T", what: "Tip" },
  { keys: "Arrows", what: "Nudge" },
  { keys: "PgUp / PgDn", what: "Raise" },
  { keys: "Esc", what: "Put back" },
  { keys: "Del", what: "Throw away" },
];

/** What is in hand, and the keys that move it. */
export function CarryHud({ carrying, placed, loose }: CarryHudProps) {
  return (
    <div className="panel pointer-events-auto flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      {carrying ? (
        <>
          <span className="readout text-ink">
            {carrying.name}
            <span className="ml-2 text-faint">
              {colorName(carrying.colorCode)}
            </span>
          </span>
          <span className="readout text-muted">
            Turn{" "}
            <span className="tabular text-ink">{carrying.yaw * 90}&deg;</span>
            {carrying.tip > 0 ? (
              <>
                {" · Tip "}
                <span className="tabular text-ink">
                  {carrying.tip * 90}&deg;
                </span>
              </>
            ) : null}
          </span>
          {carrying.blocked ? (
            <span className="readout text-warn">Will not fit here</span>
          ) : (
            <span className="readout text-accent-fg">Click to place</span>
          )}
          <dl className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {KEYS.map((row) => (
              <div className="flex items-center gap-1.5" key={row.what}>
                <dt>
                  <kbd className="readout border border-edge bg-panel-raised px-1 py-0.5 text-faint">
                    {row.keys}
                  </kbd>
                </dt>
                <dd className="text-faint text-xs">{row.what}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <span className="readout text-muted">
            <span className="tabular text-ink">{placed}</span> placed
            {loose > 0 ? (
              <>
                {" · "}
                <span className="tabular text-ink">{loose}</span> on the floor
              </>
            ) : null}
          </span>
          <span className="readout ml-auto text-faint">
            Take a part from the list, press a hotbar key, or click one on the
            floor to pick it up.
          </span>
        </>
      )}
    </div>
  );
}
