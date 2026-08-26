"use client";

import { type RefObject, useEffect } from "react";
import { isTypingTarget } from "@/lib/dom";
import type { CarriedInfo, FreeController } from "@/scene/FreeController";

export interface FreeKeys {
  carrying: CarriedInfo | null;
  controller: RefObject<FreeController | null>;
  onSlot: (index: number) => void;
  slots: number;
}

/**
 * The keyboard for free build.
 *
 * The number keys reach for a part, and everything else acts on whatever is in
 * hand. The arrows are the interesting case: they belong to the camera until
 * something is being carried, at which point they belong to the brick, because
 * a stud at a time is what "not quite there" needs and the camera can wait.
 */
export function useFreeKeys({
  controller,
  carrying,
  onSlot,
  slots,
}: FreeKeys): void {
  useEffect(() => {
    /** Everything that acts on the brick in hand. */
    const onCarryKey = (event: KeyboardEvent, scene: FreeController) => {
      switch (event.code) {
        case "KeyR":
          event.preventDefault();
          scene.rotate(event.shiftKey ? -1 : 1, 0);
          return;
        case "KeyT":
          event.preventDefault();
          scene.rotate(0, event.shiftKey ? -1 : 1);
          return;
        case "Escape":
          scene.cancelCarry();
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          scene.deleteCarried();
          return;
        default:
          break;
      }

      const step = carrying === null ? undefined : NUDGES[event.code];
      if (step) {
        event.preventDefault();
        scene.nudge(step[0], step[1], step[2]);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const digit = DIGIT.exec(event.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        if (index < slots) {
          event.preventDefault();
          onSlot(index);
        }
        return;
      }

      const scene = controller.current;
      if (scene) {
        onCarryKey(event, scene);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, carrying, onSlot, slots]);
}

const DIGIT = /^Digit([1-9])$/;

/** Grid steps, in the order the controller takes them. */
const NUDGES: Record<string, [number, number, number] | undefined> = {
  ArrowDown: [0, 0, 1],
  ArrowLeft: [-1, 0, 0],
  ArrowRight: [1, 0, 0],
  ArrowUp: [0, 0, -1],
  PageDown: [0, -1, 0],
  PageUp: [0, 1, 0],
};
