"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Close, Warning } from "@/components/Icon";
import { Inspector } from "@/components/panels/Inspector";
import { PartsBin } from "@/components/panels/PartsBin";
import { SubmodelTree } from "@/components/panels/SubmodelTree";
import { Timeline } from "@/components/panels/Timeline";
import { ViewControls } from "@/components/panels/ViewControls";
import { LegalFooter } from "@/components/shell/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  disposeModel,
  type LoadModelOptions,
  loadModel,
} from "@/ldraw/loadModel";
import { partNumber } from "@/ldraw/mpd";
import type {
  BomEntry,
  LoadProgress,
  ModelData,
  ViewMode,
} from "@/ldraw/types";
import { isTypingTarget } from "@/lib/dom";
import type { ModelMeta } from "@/lib/manifest";
import { isAnyPopoverOpen } from "@/lib/popover";
import { takeUpload, type UploadedModel } from "@/lib/uploadStore";
import type { ControllerInput } from "@/scene/SceneController";
import { loadPhysics } from "@/scene/settle";

// The viewer pulls in three.js, which has no business in the initial bundle and
// nothing useful to render on the server.
const Stage = dynamic(() => import("./Stage").then((mod) => mod.Stage), {
  loading: () => <div className="absolute inset-0 bg-ground" />,
  ssr: false,
});

const MODES = ["build", "explode", "slice"] as const;

const LOAD_FAILED = "Could not load this model.";

const failureMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : LOAD_FAILED;

/** A dropped file carries its own packed text; anything else is fetched. */
function loadOptionsFor(
  slug: string,
  title: string | undefined,
  expectedBricks: number | undefined,
  upload: UploadedModel | null,
  onProgress: (progress: LoadProgress) => void
): LoadModelOptions {
  if (upload) {
    return {
      onProgress,
      partNames: upload.partNames,
      slug,
      text: upload.text,
      title: upload.title,
    };
  }
  return {
    expectedBricks: expectedBricks ?? null,
    onProgress,
    slug,
    title: title ?? slug,
    url: `/models/${slug}.mpd`,
  };
}

export interface BuilderClientProps {
  meta: ModelMeta | null;
  slug: string;
}

export function BuilderClient({ slug, meta }: BuilderClientProps) {
  const [view, setView] = useQueryStates(
    {
      explode: parseAsFloat.withDefault(0.5),
      mode: parseAsStringLiteral(MODES).withDefault("build"),
      sel: parseAsInteger,
      slice: parseAsFloat.withDefault(1),
      step: parseAsInteger.withDefault(0),
      sub: parseAsString,
    },
    // Playback advances the step roughly once a second; replacing rather than
    // pushing keeps the back button useful, and throttling keeps the URL writes
    // off the animation's critical path.
    { clearOnDefault: true, history: "replace", throttleMs: 250 }
  );

  const [model, setModel] = useState<ModelData | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frameNonce, setFrameNonce] = useState(0);
  const [hoveredEntry, setHoveredEntry] = useState<BomEntry | null>(null);
  const [pointerBrick, setPointerBrick] = useState<number | null>(null);
  const [missingParts, setMissingParts] = useState<string[]>([]);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // Pulled out so the load effect depends on these two values rather than on
  // `meta`, which is a fresh object on every render.
  const metaTitle = meta?.title;
  const metaBricks = meta?.bricks;

  useEffect(() => {
    let cancelled = false;
    let loaded: ModelData | null = null;

    setModel(null);
    setError(null);
    setMissingParts([]);
    setWarningDismissed(false);
    setProgress({ fraction: null, phase: "fetching" });

    const run = async () => {
      const upload = slug.startsWith("local-") ? takeUpload(slug) : null;

      if (slug.startsWith("local-") && !upload) {
        setError(
          "That dropped file is no longer in memory. Uploads are kept only for the current session, so drop the file again."
        );
        setProgress(null);
        return;
      }

      try {
        const onProgress = (next: LoadProgress) => {
          if (!cancelled) {
            setProgress(next);
          }
        };
        // The physics module is WebAssembly and downloads alongside the model,
        // so the first bag's drop can be simulated the moment the scene is ready.
        const physics = loadPhysics();

        const result = await loadModel(
          loadOptionsFor(slug, metaTitle, metaBricks, upload, onProgress)
        );
        await physics;
        loaded = result;
        if (cancelled) {
          disposeModel(result);
          return;
        }
        setModel(result);
        setMissingParts(upload?.missingParts ?? []);
        setProgress(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setError(failureMessage(caught));
        setProgress(null);
      }
    };

    run().catch((caught: unknown) => {
      setError(failureMessage(caught));
      setProgress(null);
    });

    return () => {
      cancelled = true;
      if (loaded) {
        disposeModel(loaded);
      }
    };
  }, [slug, metaTitle, metaBricks]);

  const lastStep = model?.steps.length ?? 0;
  const step = Math.min(Math.max(view.step, 0), lastStep);

  const setStep = useCallback(
    (next: number) => {
      setView({ step: Math.min(Math.max(next, 0), lastStep) });
    },
    [setView, lastStep]
  );

  const handleTogglePlay = useCallback(() => {
    setPlaying((current) => {
      if (current) {
        return false;
      }
      // Pressing play at the end restarts rather than doing nothing.
      if (step >= lastStep) {
        setView({ step: 0 });
      }
      return true;
    });
  }, [step, lastStep, setView]);

  const handleSelect = useCallback(
    (brickId: number | null) => {
      setView({ sel: brickId });
    },
    [setView]
  );

  // Bricks highlighted from the parts list, so hovering a row lights up every
  // instance of that part in the scene.
  const externalHover = hoveredEntry?.brickIds[0] ?? null;

  const input = useMemo<ControllerInput>(
    () => ({
      explode: view.explode,
      isolate: view.sub,
      mode: view.mode as ViewMode,
      playing,
      selected: view.sel,
      slice: view.slice,
      speed,
      step,
    }),
    [
      view.mode,
      view.explode,
      view.slice,
      view.sub,
      view.sel,
      playing,
      speed,
      step,
    ]
  );

  const callbacks = useMemo(
    () => ({
      onFinished: () => setPlaying(false),
      onHover: (id: number | null) => setPointerBrick(id),
      onSelect: handleSelect,
      onStepAdvance: (next: number) => setStep(next),
    }),
    [setStep, handleSelect]
  );

  // Keyboard. The arrows belong to the camera now, so stepping moved to the
  // bracket and comma pairs, the two conventions for nudging along a timeline.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.code) {
        case "Space":
          event.preventDefault();
          handleTogglePlay();
          break;
        case "Period":
        case "BracketRight":
        case "PageDown":
          event.preventDefault();
          setPlaying(false);
          setStep(step + 1);
          break;
        case "Comma":
        case "BracketLeft":
        case "PageUp":
          event.preventDefault();
          setPlaying(false);
          setStep(step - 1);
          break;
        case "Escape":
          // The top layer gets Escape first, so dismissing the shortcuts sheet
          // does not also throw away the selected brick behind it.
          if (isAnyPopoverOpen()) {
            return;
          }
          handleSelect(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleTogglePlay, setStep, step, handleSelect]);

  const selectedBrick =
    model && view.sel !== null ? (model.bricks[view.sel] ?? null) : null;
  const inspected =
    selectedBrick ??
    (pointerBrick === null ? null : (model?.bricks[pointerBrick] ?? null));

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ground">
      <Stage
        callbacks={callbacks}
        className="absolute inset-0"
        externalHover={externalHover}
        frameNonce={frameNonce}
        input={input}
        model={model}
      />

      {progress || error ? (
        <Overlay
          error={error}
          progress={progress}
          title={meta?.title ?? slug}
        />
      ) : null}

      {model ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col p-4">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="panel pointer-events-auto flex items-start gap-4 px-4 py-3">
              <div>
                <Link
                  className="label inline-flex items-center gap-1.5 hover:text-ink"
                  href="/"
                >
                  <ChevronLeft className="h-3 w-3" />
                  All models
                </Link>
                <h1 className="mt-2 text-ink text-sm">{model.title}</h1>
                <p className="readout tabular mt-1 text-faint">
                  {model.bricks.length} bricks &middot; {model.steps.length}{" "}
                  steps
                  {model.bags.length > 1 && (
                    <> &middot; {model.bags.length} bags</>
                  )}
                </p>
              </div>
              <ThemeToggle className="ml-auto px-2 py-1" />
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:items-end">
              <ViewControls
                explode={view.explode}
                mode={view.mode as ViewMode}
                onExplode={(explode) => {
                  setView({ explode });
                }}
                onFrame={() => setFrameNonce((n) => n + 1)}
                onMode={(mode) => {
                  setView({ mode });
                }}
                onSlice={(slice) => {
                  setView({ slice });
                }}
                slice={view.slice}
              />
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 items-start justify-between gap-4">
            <div className="hidden w-60 flex-col gap-3 lg:flex">
              <SubmodelTree
                isolate={view.sub}
                onIsolate={(sub) => {
                  setView({ sub });
                }}
                root={model.submodels}
              />
            </div>

            <div className="hidden h-full min-h-0 w-72 flex-col gap-3 lg:flex">
              <Inspector
                brick={inspected}
                onClose={() => handleSelect(null)}
                onGoToStep={(next) => {
                  setPlaying(false);
                  // A brick's step is its index; showing it placed means
                  // counting that step as done.
                  setStep(next + 1);
                }}
                totalBags={model.bags.length}
                totalSteps={model.steps.length}
              />
              <PartsBin
                bom={model.bom}
                bricks={model.bricks}
                hoveredKey={hoveredEntry?.key ?? null}
                onHover={setHoveredEntry}
                step={step}
                steps={model.steps}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {missingParts.length > 0 && !warningDismissed && (
              <MissingPartsNotice
                onDismiss={() => setWarningDismissed(true)}
                parts={missingParts}
              />
            )}
            <Timeline
              bags={model.bags}
              onSpeed={setSpeed}
              onStep={(next) => {
                setPlaying(false);
                setStep(next);
              }}
              onTogglePlay={handleTogglePlay}
              playing={playing}
              speed={speed}
              step={step}
              steps={model.steps}
              synthetic={model.stepsAreSynthetic}
            />
            <div className="pointer-events-auto px-1">
              <LegalFooter compact />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Some parts could not be matched to the LDraw library, so they were left out.
 * This is a warning rather than a failure: everything else still builds, and
 * the person looking at it cannot install parts from here anyway. Naming the
 * parts is the useful bit, since it tells them what to go and look for.
 */
function MissingPartsNotice({
  parts,
  onDismiss,
}: {
  parts: string[];
  onDismiss: () => void;
}) {
  const shown = parts.slice(0, 6);
  const rest = parts.length - shown.length;

  return (
    <div className="panel pointer-events-auto flex items-start gap-3 border-l-2 border-l-warn px-4 py-3">
      <span className="mt-0.5 shrink-0 text-warn">
        <Warning />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ink text-sm">
          {parts.length} {parts.length === 1 ? "part is" : "parts are"} missing
          from this build
        </p>
        <p className="readout mt-1 text-faint">
          Not found in the LDraw parts library, so they were skipped. Everything
          else is here.
        </p>
        <p className="readout mt-1.5 break-words text-muted">
          {shown.map(partNumber).join(", ")}
          {rest > 0 && <span className="text-faint"> and {rest} more</span>}
        </p>
      </div>
      <button
        aria-label="Dismiss warning"
        className="hud-button shrink-0 px-2 py-1"
        onClick={onDismiss}
        title="Dismiss"
        type="button"
      >
        <Close />
      </button>
    </div>
  );
}

function Overlay({
  progress,
  error,
  title,
}: {
  progress: LoadProgress | null;
  error: string | null;
  title: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ground/90 p-6">
      <div className="panel w-full max-w-md px-6 py-6">
        <p className="label">{error ? "Could not load" : "Loading"}</p>
        <p className="mt-3 text-ink text-sm">{title}</p>

        {error ? (
          <>
            <p className="mt-3 border-danger border-l-2 pl-3 text-muted text-sm leading-relaxed">
              {error}
            </p>
            <Link className="hud-button mt-5 inline-block" href="/">
              Back to models
            </Link>
          </>
        ) : (
          <>
            <p className="readout mt-2 text-faint">{describe(progress)}</p>
            <div className="mt-4 h-0.5 w-full overflow-hidden bg-edge">
              <div className="h-full w-1/3 animate-pulse bg-accent-fg" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function describe(progress: LoadProgress | null): string {
  if (!progress) {
    return "";
  }
  switch (progress.phase) {
    case "fetching":
      return `Fetching ${progress.detail ?? "model"}…`;
    case "parsing":
      return "Building geometry…";
    case "flattening":
      return "Separating bricks…";
    case "laying-out":
      return "Tipping them onto the floor…";
    default:
      return "Ready";
  }
}
