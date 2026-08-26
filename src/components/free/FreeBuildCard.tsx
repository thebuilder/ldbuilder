"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brick } from "@/components/Icon";
import { freeBuildSummary } from "@/lib/freeStore";

/**
 * The way into the sandbox.
 *
 * It reads its own progress after mount rather than during render, because
 * localStorage does not exist on the server and a build somebody left on the
 * floor is the best reason to come back.
 */
export function FreeBuildCard() {
  const [placed, setPlaced] = useState<number | null>(null);

  useEffect(() => {
    setPlaced(freeBuildSummary()?.placed ?? null);
  }, []);

  return (
    <Link
      className="group flex h-full flex-col justify-between gap-6 bg-panel p-5 shadow-[0_0_0_1px_var(--color-edge)] transition-colors hover:bg-panel-raised"
      href="/free"
    >
      <div>
        <h3 className="flex items-center gap-2 text-base text-ink transition-colors group-hover:text-accent-fg">
          <Brick />
          Free build
        </h3>
        <p className="mt-2 text-muted text-sm leading-relaxed">
          No instructions. Tip out whatever parts you like and build something;
          bricks snap to the stud grid, and you can export it as an LDraw file.
        </p>
      </div>

      <div>
        <dl className="flex gap-6 border-edge border-t pt-3">
          <div>
            <dt className="label">Parts</dt>
            <dd className="readout tabular mt-1.5 text-ink text-sm">194</dd>
          </div>
          <div>
            <dt className="label">Colours</dt>
            <dd className="readout tabular mt-1.5 text-ink text-sm">50+</dd>
          </div>
          {placed === null ? null : (
            <div>
              <dt className="label">On the floor</dt>
              <dd className="readout tabular mt-1.5 text-accent-fg text-sm">
                {placed.toLocaleString()}
              </dd>
            </div>
          )}
        </dl>
        <p className="readout mt-3 text-faint">
          Parts library by LDraw.org, CC BY 2.0
        </p>
      </div>
    </Link>
  );
}
