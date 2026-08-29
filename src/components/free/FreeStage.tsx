"use client";

import { useEffect, useRef } from "react";
import type { Palette } from "@/ldraw/palette";
import type { FreeCallbacks, FreeController } from "@/scene/FreeController";

export interface FreeStageProps {
  callbacks: FreeCallbacks;
  className?: string;
  onController: (controller: FreeController | null) => void;
  palette: Palette;
}

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
