"use client";

import { modelName } from "@/ldraw/mpd";
import type { SubmodelNode } from "@/ldraw/types";

export interface SubmodelTreeProps {
  isolate: string | null;
  onIsolate: (path: string | null) => void;
  root: SubmodelNode;
}

/**
 * MPD files nest submodels. Isolating one dims everything else so a
 * subassembly can be looked at on its own without losing where it sits.
 */
export function SubmodelTree({ root, isolate, onIsolate }: SubmodelTreeProps) {
  if (root.children.length === 0) {
    return null;
  }

  return (
    <div className="panel pointer-events-auto flex max-h-64 flex-col">
      <div className="flex items-center justify-between border-edge border-b px-3 py-2">
        <span className="label">Submodels</span>
        {isolate !== null && (
          <button
            className="hud-button px-2 py-1"
            onClick={() => onIsolate(null)}
            type="button"
          >
            Clear
          </button>
        )}
      </div>
      <ul className="min-h-0 overflow-y-auto py-1">
        <Node
          depth={0}
          isolate={isolate}
          isRoot
          node={root}
          onIsolate={onIsolate}
        />
      </ul>
    </div>
  );
}

function Node({
  node,
  depth,
  isolate,
  onIsolate,
  isRoot = false,
}: {
  node: SubmodelNode;
  depth: number;
  isolate: string | null;
  onIsolate: (path: string | null) => void;
  isRoot?: boolean;
}) {
  const active = isolate === node.path;
  const label = isRoot ? "Whole model" : modelName(node.name);

  return (
    <>
      <li>
        <button
          className="flex w-full items-center gap-2 py-1 pr-3 text-left transition-colors hover:bg-panel-raised data-[active=true]:bg-panel-raised"
          data-active={active}
          onClick={() => onIsolate(active ? null : node.path)}
          style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
          type="button"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0"
            style={{
              backgroundColor: active
                ? "var(--color-accent-fg)"
                : "var(--color-edge-bright)",
            }}
          />
          <span className="min-w-0 flex-1 truncate text-ink text-xs">
            {label}
          </span>
          <span className="readout tabular shrink-0 text-faint">
            {node.totalBricks}
          </span>
        </button>
      </li>
      {node.children.map((child) => (
        <Node
          depth={depth + 1}
          isolate={isolate}
          key={child.path}
          node={child}
          onIsolate={onIsolate}
        />
      ))}
    </>
  );
}
