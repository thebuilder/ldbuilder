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
import { ChevronLeft, Close, Save, Warning } from "@/components/Icon";
import { BuildPanel } from "@/components/panels/BuildPanel";
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
  Brick,
  BuildProgress,
  LoadProgress,
  ModelData,
  SessionMode,
  ViewMode,
} from "@/ldraw/types";
import { isTypingTarget } from "@/lib/dom";
import type { ModelMeta } from "@/lib/manifest";
import { isAnyPopoverOpen } from "@/lib/popover";
import { takeUpload, type UploadedModel } from "@/lib/uploadStore";
import { loadPhysics } from "@/scene/physics";
import type { ControllerInput } from "@/scene/SceneController";

// The viewer pulls in three.js, which has no business in the initial bundle and
// nothing useful to render on the server.
const Stage = dynamic(() => import("./Stage").then((mod) => mod.Stage), {
  loading: () => <div className="absolute inset-0 bg-ground" />,
  ssr: false,
});

const MODES = ["assemble", "explode", "slice"] as const;
const SESSIONS = ["watch", "build"] as const;

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

/*
  fallow scores this above its cognitive threshold, and it is the one dimension
  test coverage cannot move. The score is dominated by counting React callbacks:
  the loader, the keyboard, the URL writes and the whole HUD have already been
  lifted out, leaving a component whose job is to hold state and hand it to
  four children. Splitting it further would be arranging code for a metric.
*/
// fallow-ignore-next-line complexity
export function BuilderClient({ slug, meta }: BuilderClientProps) {
  const [view, setView] = useQueryStates(
    {
      explode: parseAsFloat.withDefault(0.5),
      flow: parseAsStringLiteral(SESSIONS).withDefault("watch"),
      mode: parseAsStringLiteral(MODES).withDefault("assemble"),
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

  const { model, progress, error, missingParts } = useModelLoader(
    slug,
    meta?.title,
    meta?.bricks
  );

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frameNonce, setFrameNonce] = useState(0);
  const [hoveredEntry, setHoveredEntry] = useState<BomEntry | null>(null);
  const [pointerBrick, setPointerBrick] = useState<number | null>(null);
  // Which missing-parts list has been dismissed. Held as the array itself
  // rather than a flag, because the loader hands back a fresh one per model and
  // that makes "a different model's warning" fall out for free.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [build, setBuild] = useState<BuildProgress | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [buildReset, setBuildReset] = useState(0);
  const [resumeSeen, setResumeSeen] = useState(false);

  const session = view.flow as SessionMode;

  const lastStep = model?.steps.length ?? 0;
  const step = Math.min(Math.max(view.step, 0), lastStep);

  const setStep = useCallback(
    (next: number) => {
      setView({ step: Math.min(Math.max(next, 0), lastStep) });
    },
    [setView, lastStep]
  );

  const handleTogglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Pressing play at the end restarts rather than doing nothing.
    if (step >= lastStep) {
      setView({ step: 0 });
    }
    setPlaying(true);
  }, [playing, step, lastStep, setView]);

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
      hint,
      isolate: view.sub,
      mode: view.mode as ViewMode,
      // Nothing plays itself in build mode; the person is the playback.
      playing: playing && session === "watch",
      selected: view.sel,
      session,
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
      hint,
      playing,
      session,
      speed,
      step,
    ]
  );

  const callbacks = useMemo(
    () => ({
      onBuildProgress: setBuild,
      onFinished: () => setPlaying(false),
      onHover: (id: number | null) => setPointerBrick(id),
      onSelect: handleSelect,
      onStepAdvance: (next: number) => setStep(next),
    }),
    [setStep, handleSelect]
  );

  const handleSession = useCallback(
    (next: SessionMode) => {
      setPlaying(false);
      setHint(null);
      setResumeSeen(false);
      setView({ flow: next });
    },
    [setView]
  );

  const handleReset = useCallback(() => {
    setHint(null);
    setResumeSeen(true);
    setBuildReset((n) => n + 1);
  }, []);

  const handleScrub = useCallback(
    (next: number) => {
      setPlaying(false);
      setStep(next);
    },
    [setStep]
  );

  const handleGoToStep = useCallback(
    (next: number) => {
      setPlaying(false);
      // A brick's step is its index; showing it placed means counting that
      // step as done.
      setStep(next + 1);
    },
    [setStep]
  );

  const handleFrame = useCallback(() => setFrameNonce((n) => n + 1), []);
  const handleDismissResume = useCallback(() => setResumeSeen(true), []);
  const view0 = useViewActions(setView);

  useBuilderKeys({
    onSelect: handleSelect,
    onStep: (delta: number) => {
      setPlaying(false);
      setStep(step + delta);
    },
    onToggleHint: () => setHint(nextHint),
    onTogglePlay: handleTogglePlay,
    session,
  });

  const inspected = inspectedBrick(model, view.sel, pointerBrick);
  const title = meta?.title ?? slug;
  const onGoToStep = session === "watch" ? handleGoToStep : undefined;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ground">
      <Stage
        buildReset={buildReset}
        callbacks={callbacks}
        className="absolute inset-0"
        externalHover={externalHover}
        frameNonce={frameNonce}
        input={input}
        model={model}
      />

      <Overlay error={error} progress={progress} title={title} />

      {model ? (
        <BuilderHud
          build={build}
          explode={view.explode}
          hint={hint}
          hoveredEntry={hoveredEntry}
          inspected={inspected}
          isolate={view.sub}
          missingParts={missingParts}
          mode={view.mode as ViewMode}
          model={model}
          onDismissResume={handleDismissResume}
          onDismissWarning={() => setDismissed(missingParts)}
          onExplode={view0.onExplode}
          onFrame={handleFrame}
          onGoToStep={onGoToStep}
          onHint={setHint}
          onHoverEntry={setHoveredEntry}
          onIsolate={view0.onIsolate}
          onMode={view0.onMode}
          onReset={handleReset}
          onSelect={handleSelect}
          onSession={handleSession}
          onSlice={view0.onSlice}
          onSpeed={setSpeed}
          onStep={handleScrub}
          onTogglePlay={handleTogglePlay}
          playing={playing}
          resumeSeen={resumeSeen}
          session={session}
          slice={view.slice}
          speed={speed}
          step={step}
          warningDismissed={dismissed === missingParts}
        />
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

interface LoadedModel {
  error: string | null;
  /** Parts the packer could not resolve, so the build is missing them. */
  missingParts: string[];
  model: ModelData | null;
  progress: LoadProgress | null;
}

/**
 * Fetch, parse and lay out one model.
 *
 * Its own hook because it is the one thing here that outlives a render: an
 * abandoned load has to be cancelled and its geometry disposed, or switching
 * models twice quickly leaks a model's worth of buffers onto the GPU.
 */
function useModelLoader(
  slug: string,
  metaTitle: string | undefined,
  metaBricks: number | undefined
): LoadedModel {
  const [model, setModel] = useState<ModelData | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingParts, setMissingParts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let loaded: ModelData | null = null;

    setModel(null);
    setError(null);
    setMissingParts([]);
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

      const onProgress = (next: LoadProgress) => {
        if (!cancelled) {
          setProgress(next);
        }
      };
      // The physics module is WebAssembly and downloads alongside the model, so
      // the first bag can be dropped the moment the scene is ready. Build mode
      // cannot start at all without it.
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
    };

    run().catch((caught: unknown) => {
      if (cancelled) {
        return;
      }
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

  return { error, missingParts, model, progress };
}

type SetView = (values: {
  explode?: number;
  mode?: ViewMode;
  slice?: number;
  sub?: string | null;
}) => void;

/**
 * The controls that only ever write to the URL.
 *
 * Grouped because they are one concern with one dependency, and because a
 * component that lists a dozen one-line callbacks reads as a list of plumbing
 * rather than as what it does.
 */
function useViewActions(setView: SetView) {
  const onExplode = useCallback(
    (explode: number) => setView({ explode }),
    [setView]
  );
  const onMode = useCallback((mode: ViewMode) => setView({ mode }), [setView]);
  const onSlice = useCallback((slice: number) => setView({ slice }), [setView]);
  const onIsolate = useCallback(
    (sub: string | null) => setView({ sub }),
    [setView]
  );
  return useMemo(
    () => ({ onExplode, onIsolate, onMode, onSlice }),
    [onExplode, onIsolate, onMode, onSlice]
  );
}

/** `null` means off, `*` means everything the step still needs. */
function nextHint(current: string | null): string | null {
  return current === null ? "*" : null;
}

/**
 * The brick the inspector should describe: the one that was clicked, and
 * failing that whatever the pointer is over.
 */
function inspectedBrick(
  model: ModelData | null,
  selected: number | null,
  hovered: number | null
): Brick | null {
  if (!model) {
    return null;
  }
  const chosen = selected === null ? null : (model.bricks[selected] ?? null);
  if (chosen) {
    return chosen;
  }
  return hovered === null ? null : (model.bricks[hovered] ?? null);
}

interface BuilderHudProps extends HudFooterProps {
  explode: number;
  hoveredEntry: BomEntry | null;
  inspected: Brick | null;
  isolate: string | null;
  mode: ViewMode;
  onExplode: (value: number) => void;
  onFrame: () => void;
  /** Absent in build mode, where a step is reached by building up to it. */
  onGoToStep?: (step: number) => void;
  onHoverEntry: (entry: BomEntry | null) => void;
  onIsolate: (path: string | null) => void;
  onMode: (mode: ViewMode) => void;
  onSelect: (brickId: number | null) => void;
  onSlice: (value: number) => void;
  slice: number;
}

/**
 * Everything floating over the canvas once a model is loaded.
 *
 * Split out so `BuilderClient` is the controller and this is the view: the
 * state, the URL and the scene callbacks live there, and nothing here does
 * anything but arrange what it is handed.
 */
function BuilderHud(props: BuilderHudProps) {
  const { model, inspected, hoveredEntry, step, session } = props;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col p-4">
      <HudHeader
        explode={props.explode}
        mode={props.mode}
        model={model}
        onExplode={props.onExplode}
        onFrame={props.onFrame}
        onMode={props.onMode}
        onSession={props.onSession}
        onSlice={props.onSlice}
        session={session}
        slice={props.slice}
      />

      <SidePanels
        bom={hoveredEntry}
        inspected={inspected}
        isolate={props.isolate}
        model={model}
        onClearSelection={() => props.onSelect(null)}
        onGoToStep={props.onGoToStep}
        onHoverEntry={props.onHoverEntry}
        onIsolate={props.onIsolate}
        step={step}
      />

      <HudFooter {...props} />
    </div>
  );
}

interface HudHeaderProps {
  explode: number;
  mode: ViewMode;
  model: ModelData;
  onExplode: (value: number) => void;
  onFrame: () => void;
  onMode: (mode: ViewMode) => void;
  onSession: (session: SessionMode) => void;
  onSlice: (value: number) => void;
  session: SessionMode;
  slice: number;
}

/** The top bar: what this model is on the left, what to do with it on the right. */
function HudHeader({
  model,
  session,
  mode,
  explode,
  slice,
  onSession,
  onMode,
  onExplode,
  onSlice,
  onFrame,
}: HudHeaderProps) {
  return (
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
            {model.bricks.length} bricks &middot; {model.steps.length} steps
            {model.bags.length > 1 && <> &middot; {model.bags.length} bags</>}
          </p>
        </div>
        <ThemeToggle className="ml-auto px-2 py-1" />
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:items-end">
        <ViewControls
          explode={explode}
          mode={mode}
          onExplode={onExplode}
          onFrame={onFrame}
          onMode={onMode}
          onSession={onSession}
          onSlice={onSlice}
          session={session}
          slice={slice}
        />
      </div>
    </div>
  );
}

interface SidePanelsProps {
  /** The parts-list row under the pointer, so the scene can light it up. */
  bom: BomEntry | null;
  inspected: Brick | null;
  isolate: string | null;
  model: ModelData;
  onClearSelection: () => void;
  onGoToStep?: (step: number) => void;
  onHoverEntry: (entry: BomEntry | null) => void;
  onIsolate: (path: string | null) => void;
  step: number;
}

/** The two reference columns, which only a wide window has room for. */
function SidePanels({
  model,
  inspected,
  isolate,
  bom,
  step,
  onIsolate,
  onClearSelection,
  onGoToStep,
  onHoverEntry,
}: SidePanelsProps) {
  return (
    <div className="mt-3 flex min-h-0 flex-1 items-start justify-between gap-4">
      <div className="hidden w-60 flex-col gap-3 lg:flex">
        <SubmodelTree
          isolate={isolate}
          onIsolate={onIsolate}
          root={model.submodels}
        />
      </div>

      <div className="hidden h-full min-h-0 w-72 flex-col gap-3 lg:flex">
        <Inspector
          brick={inspected}
          onClose={onClearSelection}
          onGoToStep={onGoToStep}
          totalBags={model.bags.length}
          totalSteps={model.steps.length}
        />
        <PartsBin
          bom={model.bom}
          bricks={model.bricks}
          hoveredKey={bom?.key ?? null}
          onHover={onHoverEntry}
          step={step}
          steps={model.steps}
        />
      </div>
    </div>
  );
}

interface HudFooterProps {
  build: BuildProgress | null;
  hint: string | null;
  missingParts: string[];
  model: ModelData;
  onDismissResume: () => void;
  onDismissWarning: () => void;
  onHint: (hint: string | null) => void;
  onReset: () => void;
  onSession: (session: SessionMode) => void;
  onSpeed: (speed: number) => void;
  onStep: (step: number) => void;
  onTogglePlay: () => void;
  playing: boolean;
  resumeSeen: boolean;
  session: SessionMode;
  speed: number;
  step: number;
  warningDismissed: boolean;
}

/**
 * The stack along the bottom of the screen: whatever needs saying, then the
 * transport for whichever flow is running.
 *
 * Watch has a scrubber, because a build that plays itself is a timeline. Build
 * has neither a scrubber nor a play button, because skipping to step forty
 * would skip the only thing build mode asks you to do.
 */
function HudFooter(props: HudFooterProps) {
  const { model, session, build } = props;
  // Build mode shows nothing here until the scene has reported a step. Falling
  // back to the scrubber in the meantime would flash the wrong transport, and
  // hand over a control that skips the only thing build mode asks you to do.
  const building = session === "build" && build !== null && !build.unavailable;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <HudNotices {...props} />

      {building ? <BuildTransport {...props} build={build} /> : null}

      {session === "watch" ? (
        <Timeline
          bags={model.bags}
          onSpeed={props.onSpeed}
          onStep={props.onStep}
          onTogglePlay={props.onTogglePlay}
          playing={props.playing}
          speed={props.speed}
          step={props.step}
          steps={model.steps}
          synthetic={model.stepsAreSynthetic}
        />
      ) : null}

      <div className="pointer-events-auto px-1">
        <LegalFooter compact />
      </div>
    </div>
  );
}

/** Anything the viewer needs telling, in the order it becomes true. */
function HudNotices({
  build,
  missingParts,
  warningDismissed,
  onDismissWarning,
  onSession,
}: HudFooterProps) {
  return (
    <>
      {missingParts.length > 0 && !warningDismissed && (
        <MissingPartsNotice onDismiss={onDismissWarning} parts={missingParts} />
      )}
      {build?.unavailable ? (
        <PhysicsUnavailableNotice onWatch={() => onSession("watch")} />
      ) : null}
    </>
  );
}

/** Build mode's transport: how far in you are, and what the step still needs. */
function BuildTransport({
  build,
  model,
  hint,
  resumeSeen,
  onHint,
  onReset,
  onDismissResume,
}: HudFooterProps & { build: BuildProgress }) {
  return (
    <>
      {build.resumed && !resumeSeen ? (
        <ResumedNotice
          onDismiss={onDismissResume}
          onReset={onReset}
          step={build.step}
          total={build.totalSteps}
        />
      ) : null}
      <BuildPanel
        bricks={model.bricks}
        hint={hint}
        onHint={onHint}
        onReset={onReset}
        progress={build}
        totalBricks={model.bricks.length}
      />
    </>
  );
}

interface BuilderKeys {
  onSelect: (brickId: number | null) => void;
  onStep: (delta: number) => void;
  onToggleHint: () => void;
  onTogglePlay: () => void;
  session: SessionMode;
}

/**
 * The keyboard.
 *
 * The arrows belong to the camera, so stepping is on the bracket and comma
 * pairs, the two conventions for nudging along a timeline. Build mode drops
 * both: there is nothing to play and nothing to skip past, and it takes F for
 * the one thing it does need, which is finding a piece.
 */
function useBuilderKeys({
  session,
  onTogglePlay,
  onStep,
  onSelect,
  onToggleHint,
}: BuilderKeys): void {
  useEffect(() => {
    const clearSelection = () => {
      // The top layer gets Escape first, so dismissing the shortcuts sheet does
      // not also throw away the selected brick behind it.
      if (!isAnyPopoverOpen()) {
        onSelect(null);
      }
    };

    const onBuildKey = (event: KeyboardEvent) => {
      if (event.code === "KeyF") {
        event.preventDefault();
        onToggleHint();
        return;
      }
      if (event.code === "Escape") {
        clearSelection();
      }
    };

    const onWatchKey = (event: KeyboardEvent) => {
      switch (event.code) {
        case "Space":
          event.preventDefault();
          onTogglePlay();
          break;
        case "Period":
        case "BracketRight":
        case "PageDown":
          event.preventDefault();
          onStep(1);
          break;
        case "Comma":
        case "BracketLeft":
        case "PageUp":
          event.preventDefault();
          onStep(-1);
          break;
        case "Escape":
          clearSelection();
          break;
        default:
          break;
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (session === "build") {
        onBuildKey(event);
        return;
      }
      onWatchKey(event);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, onTogglePlay, onStep, onSelect, onToggleHint]);
}

/**
 * A build was found and picked up. Said once, with the way out next to it,
 * because silently restoring somebody into the middle of a model is startling
 * and the only thing they might want instead is to start again.
 */
function ResumedNotice({
  step,
  total,
  onReset,
  onDismiss,
}: {
  step: number;
  total: number;
  onReset: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="panel pointer-events-auto flex items-center gap-3 border-l-2 border-l-accent px-4 py-2.5">
      <span className="shrink-0 text-accent-fg">
        <Save />
      </span>
      <p className="readout min-w-0 flex-1 text-muted">
        Picked your build up at step{" "}
        <span className="tabular text-ink">{step + 1}</span> of {total}.
      </p>
      <button className="hud-button px-2 py-1" onClick={onReset} type="button">
        Start over
      </button>
      <button
        aria-label="Dismiss"
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

/**
 * Build mode is the physics, so there is no reduced version of it to fall back
 * to the way the poured bag falls back to a scripted drop.
 */
function PhysicsUnavailableNotice({ onWatch }: { onWatch: () => void }) {
  return (
    <div className="panel pointer-events-auto flex items-center gap-3 border-l-2 border-l-warn px-4 py-3">
      <span className="shrink-0 text-warn">
        <Warning />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ink text-sm">Build mode needs the physics engine</p>
        <p className="readout mt-1 text-faint">
          It could not be loaded in this browser. Watching the model build
          itself still works.
        </p>
      </div>
      <button className="hud-button shrink-0" onClick={onWatch} type="button">
        Watch instead
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
  if (!(progress || error)) {
    return null;
  }

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
