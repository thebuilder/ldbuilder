"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";
import { loadPalette, type Palette } from "@/ldraw/palette";
import { type HotbarEntry, readHotbar, writeHotbar } from "@/lib/freeStore";
import type { FreeController } from "@/scene/FreeController";

/** Nine slots, on the number keys. */
export const HOTBAR_SLOTS = 9;

/** Red, and five of a part: the two answers that need no thought to change. */
const DEFAULT_COLOR = 4;
const DEFAULT_POUR = 5;

const EMPTY: (HotbarEntry | null)[] = Array.from(
  { length: HOTBAR_SLOTS },
  () => null
);

/**
 * Fetch the parts pack.
 *
 * Its own hook because it is the one thing on this page that can fail in a way
 * worth a screen of its own: a checkout that has never run `pnpm ldraw:palette`
 * has no parts, and saying so beats an empty inventory.
 */
export function usePalette(): {
  error: string | null;
  palette: Palette | null;
} {
  const [palette, setPalette] = useState<Palette | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPalette()
      .then((loaded) => {
        if (!cancelled) {
          setPalette(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "the parts could not load"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { error, palette };
}

export interface Hotbar {
  clear: (index: number) => void;
  /** Pin a part, or unpin it if that part and colour is already up there. */
  pin: (file: string, colorCode: number) => void;
  slots: (HotbarEntry | null)[];
}

/**
 * The slots, and where they are kept.
 *
 * They outlive the session because the parts somebody reaches for are a
 * property of how they build rather than of what they are building today.
 */
export function useHotbar(): Hotbar {
  const [slots, setSlots] = useState<(HotbarEntry | null)[]>(EMPTY);

  useEffect(() => {
    const stored = readHotbar();
    if (stored) {
      setSlots(
        Array.from(
          { length: HOTBAR_SLOTS },
          (_, index) => stored[index] ?? null
        )
      );
    }
  }, []);

  const save = useCallback((next: (HotbarEntry | null)[]) => {
    setSlots(next);
    writeHotbar(next);
  }, []);

  const clear = useCallback(
    (index: number) => {
      save(slots.map((slot, i) => (i === index ? null : slot)));
    },
    [slots, save]
  );

  const pin = useCallback(
    (file: string, colorCode: number) => {
      const already = slots.findIndex(
        (slot) => slot?.file === file && slot.colorCode === colorCode
      );
      if (already >= 0) {
        clear(already);
        return;
      }
      const free = slots.indexOf(null);
      const index = free >= 0 ? free : 0;
      save(slots.map((slot, i) => (i === index ? { colorCode, file } : slot)));
    },
    [slots, save, clear]
  );

  return { clear, pin, slots };
}

export interface FreeActions {
  /** Which hotbar slot was last reached for, so the bar can show it. */
  activeSlot: number | null;
  /** The colour new parts come out in. */
  colorCode: number;
  pin: (file: string) => void;
  pour: (file: string, count: number) => void;
  pourCount: number;
  selectSlot: (index: number) => void;
  setColor: (code: number) => void;
  setPourCount: (count: number) => void;
  take: (file: string) => void;
}

/**
 * Everything that means "reach for a part".
 *
 * Taking one out, tipping a handful onto the floor, pinning one to the hotbar
 * and reaching for a pinned one are four faces of the same thing, and all four
 * need the colour that is currently chosen. Kept together so the component that
 * draws the inventory does not also have to own how it is used.
 */
export function useFreeActions(
  controller: RefObject<FreeController | null>,
  hotbar: Hotbar
): FreeActions {
  const [colorCode, setColorCode] = useState(DEFAULT_COLOR);
  const [pourCount, setPourCount] = useState(DEFAULT_POUR);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const reachFor = useCallback(
    (file: string, code: number) => {
      controller.current?.arm({ colorCode: code, file });
      controller.current?.takeOut(file, code);
    },
    [controller]
  );

  const take = useCallback(
    (file: string) => reachFor(file, colorCode),
    [reachFor, colorCode]
  );

  const pour = useCallback(
    (file: string, count: number) => {
      controller.current?.pourOut(file, colorCode, count);
    },
    [controller, colorCode]
  );

  const pin = useCallback(
    (file: string) => hotbar.pin(file, colorCode),
    [hotbar, colorCode]
  );

  const selectSlot = useCallback(
    (index: number) => {
      const slot = hotbar.slots[index];
      if (!slot) {
        return;
      }
      setActiveSlot(index);
      setColorCode(slot.colorCode);
      reachFor(slot.file, slot.colorCode);
    },
    [hotbar, reachFor]
  );

  const setColor = useCallback(
    (code: number) => {
      setColorCode(code);
      // A colour is a choice about what comes next, not about what is in hand.
      controller.current?.arm(null);
    },
    [controller]
  );

  return {
    activeSlot,
    colorCode,
    pin,
    pour,
    pourCount,
    selectSlot,
    setColor,
    setPourCount,
    take,
  };
}
