"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { ViewMode } from "@/ldraw/types";
import { ensurePopoverSupport } from "@/lib/popover";

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { hint: "Assemble the model step by step", id: "build", label: "Build" },
  {
    hint: "Pull the finished model apart for inspection",
    id: "explode",
    label: "Explode",
  },
  {
    hint: "Cut away everything above a height to see inside",
    id: "slice",
    label: "Slice",
  },
];

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["W", "A", "S", "D"], what: "Move across the floor" },
  { keys: ["Q", "E"], what: "Lower, raise" },
  { keys: ["Shift"], what: "Move faster" },
  { keys: ["Drag"], what: "Orbit" },
  { keys: ["Scroll"], what: "Zoom" },
  { keys: ["Space"], what: "Play or pause" },
  { keys: ["[", "]"], what: "Step back, forward" },
  { keys: ["Esc"], what: "Clear selection" },
];

export interface ViewControlsProps {
  explode: number;
  mode: ViewMode;
  onExplode: (value: number) => void;
  onFrame: () => void;
  onMode: (mode: ViewMode) => void;
  onSlice: (value: number) => void;
  slice: number;
}

export function ViewControls({
  mode,
  explode,
  slice,
  onMode,
  onExplode,
  onSlice,
  onFrame,
}: ViewControlsProps) {
  // useId contains colons, which are legal in an id attribute but not in a CSS
  // selector, and the popover polyfill uses selectors internally.
  const popoverId = `shortcuts-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => ensurePopoverSupport(), []);

  /**
   * Drop the popover out from under the whole panel, aligned to its right edge.
   *
   * Measured off the panel rather than the button that opens it: anchoring to
   * the button puts the sheet on top of the mode row directly beneath it, so it
   * covers the controls it is describing.
   *
   * CSS anchor positioning would say this declaratively, but no major browser
   * ships it and its polyfill cannot do position-area on popovers. A popover
   * sits in the top layer and is positioned against the viewport whatever
   * happens, so measuring is the whole job.
   */
  const place = useCallback(() => {
    const panel = panelRef.current;
    const popover = popoverRef.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref is null until React attaches it; Biome does not resolve useRef's generic
    if (!(panel && popover)) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`;
  }, []);

  useEffect(() => {
    const popover = popoverRef.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref is null until React attaches it; Biome does not resolve useRef's generic
    if (!popover) {
      return;
    }

    const onBeforeToggle = (event: Event) => {
      if ((event as Event & { newState?: string }).newState === "open") {
        place();
      }
    };

    popover.addEventListener("beforetoggle", onBeforeToggle);
    window.addEventListener("resize", place);
    return () => {
      popover.removeEventListener("beforetoggle", onBeforeToggle);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  return (
    <div
      className="panel pointer-events-auto w-full px-4 py-3 sm:w-64"
      ref={panelRef}
    >
      <div className="flex items-center justify-between">
        <span className="label">View</span>
        <div className="flex gap-1">
          <button
            aria-label="Keyboard shortcuts"
            className="hud-button px-2 py-1"
            popoverTarget={popoverId}
            title="Keyboard shortcuts"
            type="button"
          >
            ?
          </button>
          <button
            className="hud-button px-2 py-1"
            onClick={onFrame}
            type="button"
          >
            Frame
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px bg-edge">
        {MODES.map((item) => (
          <button
            className="hud-button border-0 px-1"
            data-active={mode === item.id}
            key={item.id}
            onClick={() => onMode(item.id)}
            title={item.hint}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === "explode" && (
        <Slider
          format={(value) => `${Math.round(value * 100)}%`}
          label="Separation"
          onChange={onExplode}
          value={explode}
        />
      )}

      {mode === "slice" && (
        <Slider
          format={(value) => `${Math.round(value * 100)}%`}
          label="Cut height"
          onChange={onSlice}
          value={slice}
        />
      )}

      <div
        className="hud-popover"
        id={popoverId}
        popover="auto"
        ref={popoverRef}
      >
        <div className="panel w-60 px-4 py-3">
          <p className="label">Shortcuts</p>
          <dl className="mt-3 space-y-1.5">
            {SHORTCUTS.map((row) => (
              <div className="flex items-center gap-2" key={row.what}>
                <dt className="flex shrink-0 gap-1">
                  {row.keys.map((key) => (
                    <kbd
                      className="readout min-w-[1.5rem] border border-edge bg-panel-raised px-1 py-0.5 text-center text-faint"
                      key={key}
                    >
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="text-faint text-xs">{row.what}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  format,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="readout tabular text-muted">{format(value)}</span>
      </div>
      <input
        aria-label={label}
        className="slider mt-1 w-full"
        max={1}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        step={0.01}
        type="range"
        value={value}
      />
    </div>
  );
}
