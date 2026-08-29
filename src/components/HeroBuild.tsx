"use client";

import { useEffect, useRef } from "react";
import type { HeroScene } from "@/scene/HeroScene";

/**
 * The model behind the header.
 *
 * Decorative, and marked as such: it says nothing the text beside it does not
 * already say, and everything it does happens on its own. The three.js side is
 * imported after mount, so a page that is mostly type does not ship a renderer
 * to get painted, and the loop is parked the moment the header scrolls away.
 */

const WIDE_BIAS = { x: 0.72, y: 0.5 };
const NARROW_BIAS = { x: 0.5, y: 0.74 };

/**
 * Where the layout switches, in pixels.
 *
 * Tailwind's `lg`, and it has to stay Tailwind's `lg`: the veil below picks its
 * direction at that breakpoint, and a canvas biased for one arrangement under
 * the veil meant for the other buries the model in the heavy end of a gradient.
 */
const WIDE_PX = 1024;

export function HeroBuild({
  className = "",
  slug,
  title,
  url,
}: {
  className?: string;
  slug: string;
  title: string;
  url: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref is null until React attaches it; Biome does not resolve useRef's generic
    if (!canvas) {
      return;
    }

    let scene: HeroScene | null = null;
    let disposed = false;
    const parent = canvas.parentElement;

    const size = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const bias = width >= WIDE_PX ? WIDE_BIAS : NARROW_BIAS;
      scene?.setBias(bias.x, bias.y);
      scene?.resize(width, height);
    });
    const visible = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        scene?.start();
      } else {
        scene?.stop();
      }
    });

    const run = async () => {
      const { HeroScene: Scene } = await import("@/scene/HeroScene");
      // The import is a suspension point, so the effect may already have been
      // cleaned up; the same is true after the model has loaded.
      if (disposed) {
        return;
      }
      scene = new Scene(canvas);
      if (parent) {
        size.observe(parent);
        const bias = parent.clientWidth >= WIDE_PX ? WIDE_BIAS : NARROW_BIAS;
        scene.setBias(bias.x, bias.y);
        scene.resize(parent.clientWidth, parent.clientHeight);
      }

      await scene.open({ slug, title, url });
      if (disposed) {
        return;
      }
      visible.observe(canvas);
      scene.start();
    };

    run().catch((error: unknown) => {
      // No WebGL, or a model this deployment has not packed. The header reads
      // fine as type on its own, so nothing is put in its place.
      console.warn("[ldraw] hero could not start", error);
    });

    return () => {
      disposed = true;
      size.disconnect();
      visible.disconnect();
      scene?.dispose();
      scene = null;
    };
  }, [slug, title, url]);

  return (
    // Hidden from assistive tech as a whole: the canvas says nothing the
    // header does not, and it has no control a screen reader could offer.
    <div aria-hidden="true" className={`absolute inset-0 ${className}`}>
      <canvas
        className="block h-full w-full cursor-grab touch-pan-y active:cursor-grabbing"
        ref={canvasRef}
      />
      {/*
        The type has to stay readable over whatever brick happens to be behind
        it, and no further: one heading in 60px semibold needs far less cover
        than a paragraph would, so the veil is gone well before the model is.
        It runs left to right beside the type and top to bottom above it,
        matching whichever way the header has arranged the two.

        The far stop is the ground colour at zero alpha rather than
        `transparent`. They are not the same: `transparent` is transparent
        black, and a gradient run to it in oklab passes through colours that are
        neither, which on a near-black header shows up as vertical banding.
      */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-52% from-ground to-78% to-ground/0 lg:bg-gradient-to-r lg:from-32% lg:from-ground lg:to-66% lg:to-ground/0" />
    </div>
  );
}
