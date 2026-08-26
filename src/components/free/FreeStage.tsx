"use client";

import { useEffect, useRef } from "react";
import type { Palette } from "@/ldraw/palette";
import type { FreeCallbacks, FreeController } from "@/scene/FreeController";

export interface FreeStageProps {
  callbacks: FreeCallbacks;
  className?: string;
  /** Handed the controller once it exists, and null when it goes away. */
  onController: (controller: FreeController | null) => void;
  palette: Palette;
}

/**
 * The canvas, and the controller that owns it.
 *
 * Free build is imperative in a way a scrubber is not: "take one out", "turn
 * it", "put it down" are commands, not state to re-render from. So the
 * controller is handed upward rather than driven by props, and React keeps only
 * what it has to draw.
 */
export function FreeStage({
  palette,
  callbacks,
  onController,
  className = "",
}: FreeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Callbacks change identity every render; hold them in a ref so the
  // controller is never torn down just because a closure was recreated.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const onControllerRef = useRef(onController);
  onControllerRef.current = onController;

  useEffect(() => {
    const canvas = canvasRef.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref is null until React attaches it; Biome does not resolve useRef's generic
    if (!canvas) {
      return;
    }

    let controller: FreeController | null = null;
    let disposed = false;
    const parent = canvas.parentElement;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      controller?.resize(width, height);
    });

    const run = async () => {
      const { FreeController: Controller } = await import(
        "@/scene/FreeController"
      );
      // The import is a suspension point, so the effect may already have been
      // cleaned up. Checking after every one of them, and disposing anything
      // built in between, is what keeps a remount from leaving a second
      // controller behind with its own listeners on the window.
      if (disposed) {
        return;
      }
      controller = new Controller(canvas);
      if (disposed) {
        controller.dispose();
        controller = null;
        return;
      }

      controller.setCallbacks({
        onProgress: (progress) => callbacksRef.current.onProgress?.(progress),
      });
      if (parent) {
        observer.observe(parent);
        controller.resize(parent.clientWidth, parent.clientHeight);
      }

      await controller.open(palette, true);
      if (disposed) {
        return;
      }
      controller.start();
      onControllerRef.current(controller);
    };

    run().catch((error: unknown) => {
      console.warn("[ldraw] free build failed to open", error);
    });

    return () => {
      disposed = true;
      observer.disconnect();
      onControllerRef.current(null);
      controller?.dispose();
      controller = null;
    };
  }, [palette]);

  return (
    <div className={className}>
      <canvas className="block h-full w-full touch-none" ref={canvasRef} />
    </div>
  );
}
