"use client";

import { type RefObject, useCallback, useState } from "react";
import { Restart, Save } from "@/components/Icon";
import { clearFreeBuild } from "@/lib/freeStore";
import type { FreeController } from "@/scene/FreeController";

export interface BuildActionsProps {
  controller: RefObject<FreeController | null>;
  loose: number;
  placed: number;
}

/** Counts, and the three things you do to a build as a whole. */
export function BuildActions({ controller, placed, loose }: BuildActionsProps) {
  const [confirming, setConfirming] = useState(false);

  const download = useCallback(() => {
    const scene = controller.current;
    if (!scene) {
      return;
    }
    save(scene.toLdraw("Free build"), "free-build.ldr");
  }, [controller]);

  const clear = useCallback(() => {
    controller.current?.clearAll();
    clearFreeBuild();
    setConfirming(false);
  }, [controller]);

  return (
    <div className="panel pointer-events-auto w-56 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Build</span>
        <span className="readout text-muted">
          <span className="tabular text-ink">{placed}</span> placed
        </span>
      </div>
      <p className="readout mt-1 text-faint">
        <span className="tabular">{loose}</span> loose on the floor
      </p>

      <div className="mt-3 grid grid-cols-2 gap-1">
        <button
          className="hud-button px-2"
          onClick={() => controller.current?.frame()}
          type="button"
        >
          Frame
        </button>
        <button
          className="hud-button px-2"
          disabled={placed === 0}
          onClick={download}
          title="Download this build as an LDraw file"
          type="button"
        >
          <Save />
          Export
        </button>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <button
          className="hud-button px-2"
          disabled={loose === 0}
          onClick={() => controller.current?.clearLoose()}
          title="Sweep the loose bricks off the floor"
          type="button"
        >
          Sweep
        </button>
        {confirming ? (
          <button
            className="hud-button border-danger px-2 text-danger"
            onClick={clear}
            type="button"
          >
            Sure?
          </button>
        ) : (
          <button
            className="hud-button px-2"
            disabled={placed === 0 && loose === 0}
            onBlur={() => setConfirming(false)}
            onClick={() => setConfirming(true)}
            title="Throw the whole build away"
            type="button"
          >
            <Restart />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Hand the file to the browser.
 *
 * An object URL rather than a data one: a build of a few thousand parts is
 * larger than some browsers will accept in a `data:` href, and the URL is
 * revoked on the next turn of the loop either way.
 */
function save(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
