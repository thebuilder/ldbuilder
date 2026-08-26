"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Replay,
} from "@/components/Icon";
import type { BagInfo, StepInfo } from "@/ldraw/types";

export interface TimelineProps {
  bags: BagInfo[];
  onSpeed: (speed: number) => void;
  onStep: (step: number) => void;
  onTogglePlay: () => void;
  playing: boolean;
  speed: number;
  step: number;
  steps: StepInfo[];
  synthetic: boolean;
}

const SPEEDS = [0.5, 1, 2, 4];

function TransportIcon({ done, playing }: { done: boolean; playing: boolean }) {
  if (playing) {
    return <Pause />;
  }
  return done ? <Replay /> : <Play />;
}

function transportLabel(playing: boolean, done: boolean): string {
  if (playing) {
    return "Pause";
  }
  return done ? "Replay" : "Build";
}

export function Timeline({
  steps,
  bags,
  step,
  playing,
  speed,
  synthetic,
  onStep,
  onTogglePlay,
  onSpeed,
}: TimelineProps) {
  // `step` is how many steps are finished, so it runs 0..steps.length and the
  // label names the step being worked on, one ahead of the count.
  const total = steps.length;
  const done = step >= total;
  const workingStep = Math.min(step, Math.max(total - 1, 0));
  const activeBag = steps[workingStep]?.bag ?? 0;
  const bag = bags[activeBag];

  return (
    <div className="panel pointer-events-auto px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous step"
            className="hud-button"
            disabled={step === 0}
            onClick={() => onStep(Math.max(0, step - 1))}
            title="Previous step"
            type="button"
          >
            <ChevronsLeft />
          </button>
          <button
            className="hud-button w-24"
            data-active={playing}
            onClick={onTogglePlay}
            type="button"
          >
            <TransportIcon done={done} playing={playing} />
            {transportLabel(playing, done)}
          </button>
          <button
            aria-label="Next step"
            className="hud-button"
            disabled={done}
            onClick={() => onStep(Math.min(total, step + 1))}
            title="Next step"
            type="button"
          >
            <ChevronsRight />
          </button>
        </div>

        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <span className="readout text-ink">
              {done ? (
                "Complete"
              ) : (
                <>
                  Step <span className="tabular">{step + 1}</span>
                  <span className="text-faint"> / {total}</span>
                </>
              )}
              {synthetic ? (
                <span
                  className="ml-2 text-warn"
                  title="This file has no build steps of its own. The order shown is inferred from how the model stacks up."
                >
                  inferred
                </span>
              ) : null}
            </span>
            {bags.length > 1 && bag ? (
              <span className="readout text-muted">
                Bag <span className="tabular text-ink">{activeBag + 1}</span>
                <span className="text-faint"> / {bags.length}</span>
                {bag.label ? (
                  <span className="ml-2 text-faint">{bag.label}</span>
                ) : null}
              </span>
            ) : null}
          </div>

          <ScrubTrack bags={bags} onStep={onStep} step={step} total={total} />
        </div>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {SPEEDS.map((option) => (
            <button
              className="hud-button px-2"
              data-active={speed === option}
              key={option}
              onClick={() => onSpeed(option)}
              type="button"
            >
              {option}&times;
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The scrubber. A native range input handles keyboard and pointer for free;
 * the bag boundaries are drawn as ticks behind it so the structure of a long
 * build is visible at a glance.
 */
function ScrubTrack({
  total,
  bags,
  step,
  onStep,
}: {
  total: number;
  bags: BagInfo[];
  step: number;
  onStep: (step: number) => void;
}) {
  const progress = total === 0 ? 0 : step / total;

  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-edge-bright" />
      <div
        className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-accent-fg"
        style={{ width: `${progress * 100}%` }}
      />
      {bags.length > 1 &&
        bags.slice(1).map((entry) => (
          <span
            aria-hidden
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-edge-bright"
            key={entry.index}
            style={{
              left: `${total === 0 ? 0 : (entry.firstStep / total) * 100}%`,
            }}
          />
        ))}
      <input
        aria-label="Build step"
        className="slider relative w-full"
        max={total}
        min={0}
        onChange={(event) => onStep(Number(event.target.value))}
        step={1}
        type="range"
        value={step}
      />
    </div>
  );
}
