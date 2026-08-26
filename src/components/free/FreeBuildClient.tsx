"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type RefObject, useCallback, useRef, useState } from "react";
import { ChevronLeft, Warning } from "@/components/Icon";
import { LegalFooter } from "@/components/shell/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Palette } from "@/ldraw/palette";
import type { HotbarEntry } from "@/lib/freeStore";
import type { FreeController, FreeProgress } from "@/scene/FreeController";
import { BuildActions } from "./BuildActions";
import { CarryHud } from "./CarryHud";
import { Hotbar } from "./Hotbar";
import { PartsInventory } from "./PartsInventory";
import { useFreeKeys } from "./useFreeKeys";
import {
  type FreeActions,
  HOTBAR_SLOTS,
  type Hotbar as HotbarState,
  useFreeActions,
  useHotbar,
  usePalette,
} from "./useFreeState";

// three.js and a 1.9MB parts pack have no business in the gallery's bundle.
const FreeStage = dynamic(
  () => import("./FreeStage").then((mod) => mod.FreeStage),
  { loading: () => <div className="absolute inset-0 bg-ground" />, ssr: false }
);

export function FreeBuildClient() {
  const { palette, error } = usePalette();
  const hotbar = useHotbar();
  const controllerRef = useRef<FreeController | null>(null);
  const actions = useFreeActions(controllerRef, hotbar);
  const [progress, setProgress] = useState<FreeProgress | null>(null);

  const handleController = useCallback((controller: FreeController | null) => {
    controllerRef.current = controller;
  }, []);

  useFreeKeys({
    carrying: progress?.carrying ?? null,
    controller: controllerRef,
    onSlot: actions.selectSlot,
    slots: HOTBAR_SLOTS,
  });

  const problem = error ?? progress?.problem ?? null;
  if (problem) {
    return <Problem message={problem} />;
  }
  if (!palette) {
    return (
      <div className="relative h-dvh w-full overflow-hidden bg-ground">
        <Loading />
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ground">
      <FreeStage
        callbacks={{ onProgress: setProgress }}
        className="absolute inset-0"
        onController={handleController}
        palette={palette}
      />
      <FreeHud
        actions={actions}
        controller={controllerRef}
        hotbar={hotbar}
        palette={palette}
        progress={progress}
      />
    </div>
  );
}

interface FreeHudProps {
  actions: FreeActions;
  controller: RefObject<FreeController | null>;
  hotbar: HotbarState;
  palette: Palette;
  progress: FreeProgress | null;
}

/**
 * Everything floating over the floor.
 *
 * The parts box gets a full column of its own rather than whatever is left
 * between the other panels, because in this mode it is the thing you spend your
 * time in: a build uses five parts and the box holds two hundred.
 */
function FreeHud(props: FreeHudProps) {
  const { palette, progress, hotbar, actions } = props;
  const placed = progress?.placed ?? 0;
  const loose = progress?.loose ?? 0;
  const parts = palette.groups.reduce((n, group) => n + group.parts.length, 0);

  return (
    <div className="pointer-events-none absolute inset-0 flex gap-3 p-4">
      <div className="flex h-full min-h-0 w-80 flex-col gap-3">
        <div className="panel pointer-events-auto flex shrink-0 items-start gap-4 px-4 py-3">
          <div>
            <Link
              className="label inline-flex items-center gap-1.5 hover:text-ink"
              href="/"
            >
              <ChevronLeft className="h-3 w-3" />
              All models
            </Link>
            <h1 className="mt-2 text-ink text-sm">Free build</h1>
            <p className="readout tabular mt-1 text-faint">
              {parts} parts available
            </p>
          </div>
          <ThemeToggle className="ml-auto px-2 py-1" />
        </div>

        <PartsInventory
          colorCode={actions.colorCode}
          groups={palette.groups}
          onColor={actions.setColor}
          onPin={actions.pin}
          onPour={actions.pour}
          onPourCount={actions.setPourCount}
          onTake={actions.take}
          pinned={hotbar.slots
            .filter((slot): slot is HotbarEntry => slot !== null)
            .map((slot) => slot.file)}
          pourCount={actions.pourCount}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex justify-end">
          <BuildActions
            controller={props.controller}
            loose={loose}
            placed={placed}
          />
        </div>

        <div className="flex-1" />

        <CarryHud
          carrying={progress?.carrying ?? null}
          loose={loose}
          placed={placed}
        />
        <div className="flex items-end justify-between gap-3">
          <Hotbar
            active={actions.activeSlot}
            byFile={palette.byFile}
            onClear={hotbar.clear}
            onSelect={actions.selectSlot}
            slots={hotbar.slots}
          />
          <div className="pointer-events-auto">
            <LegalFooter compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ground/90 p-6">
      <div className="panel w-full max-w-md px-6 py-6">
        <p className="label">Loading</p>
        <p className="mt-3 text-ink text-sm">The parts box</p>
        <p className="readout mt-2 text-faint">
          Unpacking a couple of hundred parts&hellip;
        </p>
        <div className="mt-4 h-0.5 w-full overflow-hidden bg-edge">
          <div className="h-full w-1/3 animate-pulse bg-accent-fg" />
        </div>
      </div>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-ground p-6">
      <div className="panel w-full max-w-md px-6 py-6">
        <p className="label flex items-center gap-2">
          <span className="text-warn">
            <Warning />
          </span>
          Free build is unavailable
        </p>
        <p className="mt-3 border-warn border-l-2 pl-3 text-muted text-sm leading-relaxed">
          {message}
        </p>
        <Link className="hud-button mt-5 inline-block" href="/">
          Back to models
        </Link>
      </div>
    </div>
  );
}
