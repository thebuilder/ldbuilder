"use client";

import { useEffect, useRef } from "react";
import type { ModelData } from "@/ldraw/types";
import {
  type ControllerInput,
  type SceneCallbacks,
  SceneController,
} from "@/scene/SceneController";

export interface StageProps {
  callbacks: SceneCallbacks;
  className?: string;
  /** Hover driven from the parts list rather than the pointer. */
  externalHover: number | null;
  /** Increment to re-frame the camera. */
  frameNonce: number;
  input: ControllerInput;
  model: ModelData | null;
}

export function Stage({
  model,
  input,
  callbacks,
  externalHover,
  frameNonce,
  className = "",
}: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);

  // Callbacks change identity every render; hold them in a ref so the
  // controller is never torn down just because a closure was recreated.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const canvas = canvasRef.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref is null until React attaches it; Biome does not resolve useRef's generic
    if (!canvas) {
      return;
    }

    const controller = new SceneController(canvas);
    controllerRef.current = controller;
    controller.setCallbacks({
      onFinished: () => callbacksRef.current.onFinished?.(),
      onHover: (id) => callbacksRef.current.onHover?.(id),
      onSelect: (id) => callbacksRef.current.onSelect?.(id),
      onStepAdvance: (step) => callbacksRef.current.onStepAdvance?.(step),
    });

    const parent = canvas.parentElement;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      controller.resize(width, height);
    });
    if (parent) {
      observer.observe(parent);
      controller.resize(parent.clientWidth, parent.clientHeight);
    }

    controller.start();

    return () => {
      observer.disconnect();
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setModel(model);
  }, [model]);

  useEffect(() => {
    controllerRef.current?.setInput(input);
  }, [input]);

  useEffect(() => {
    controllerRef.current?.setHovered(externalHover);
  }, [externalHover]);

  useEffect(() => {
    if (frameNonce > 0) {
      controllerRef.current?.frameModel(true);
    }
  }, [frameNonce]);

  return (
    <div className={className}>
      <canvas className="block h-full w-full touch-none" ref={canvasRef} />
    </div>
  );
}
