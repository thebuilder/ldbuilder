"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readBuild } from "@/lib/buildStore";

export interface ResumeBadgeProps {
  slug: string;
  steps: number;
}

/**
 * A saved build, offered from the gallery card it belongs to.
 *
 * Reads after mount rather than during render: localStorage does not exist on
 * the server, and a build that is only discoverable by opening the model and
 * switching modes is one most people would never find again.
 */
export function ResumeBadge({ slug, steps }: ResumeBadgeProps) {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    const save = readBuild(slug);
    if (save && save.step > 0 && save.steps === steps) {
      setStep(save.step);
    }
  }, [slug, steps]);

  if (step === null) {
    return null;
  }

  const percent = steps === 0 ? 0 : Math.round((step / steps) * 100);

  return (
    <Link
      className="hud-button absolute right-5 bottom-4 border-accent px-2 py-1 text-accent-fg"
      href={`/build/${slug}?flow=build`}
      title={`You are on step ${step + 1} of ${steps}`}
    >
      Resume <span className="tabular">{percent}%</span>
    </Link>
  );
}
