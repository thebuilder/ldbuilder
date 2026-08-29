"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "@/components/Icon";

/**
 * Flips between light and dark.
 *
 * The label is rendered blank until mounted. The server has no idea which theme
 * the browser will resolve to, so rendering one before hydration guarantees the
 * wrong one for half the visitors, and it visibly swaps.
 */
function ToggleIcon({
  isDark,
  mounted,
}: {
  isDark: boolean;
  mounted: boolean;
}) {
  if (!mounted) {
    return <span className="h-3.5 w-3.5" />;
  }
  return isDark ? <Sun /> : <Moon />;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  const next = isDark ? "light" : "dark";

  return (
    <button
      aria-label={mounted ? `Switch to ${next} theme` : "Switch theme"}
      className={`hud-button hud-square ${className}`}
      onClick={() => setTheme(next)}
      title={mounted ? `Switch to ${next} theme` : "Switch theme"}
      type="button"
    >
      <ToggleIcon isDark={isDark} mounted={mounted} />
      <span className="sr-only">
        {mounted ? `Switch to ${next} theme` : "Switch theme"}
      </span>
    </button>
  );
}
