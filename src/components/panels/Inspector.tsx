"use client";

import { colorHex, colorName, isTranslucent } from "@/ldraw/colors.generated";
import { modelName, partNumber } from "@/ldraw/mpd";
import type { Brick } from "@/ldraw/types";

export interface InspectorProps {
  brick: Brick | null;
  onClose: () => void;
  onGoToStep: (step: number) => void;
  totalBags: number;
  totalSteps: number;
}

export function Inspector({
  brick,
  totalSteps,
  totalBags,
  onClose,
  onGoToStep,
}: InspectorProps) {
  if (!brick) {
    return null;
  }

  const submodel =
    brick.submodelPath.at(-1) === undefined
      ? "Main model"
      : modelName(brick.submodelPath.at(-1) as string);

  return (
    <div className="panel pointer-events-auto">
      <div className="flex items-center justify-between border-edge border-b px-3 py-2">
        <span className="label">Brick</span>
        <button
          className="hud-button px-2 py-1"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="flex items-start gap-3 px-3 py-3">
        <span
          aria-hidden
          className="mt-0.5 h-8 w-8 shrink-0 border border-edge-bright"
          style={{
            backgroundColor: colorHex(brick.colorCode),
            opacity: isTranslucent(brick.colorCode) ? 0.65 : 1,
          }}
        />
        <div className="min-w-0">
          <p className="text-ink text-sm leading-snug">{brick.partName}</p>
          <p className="readout mt-1 text-faint">
            {partNumber(brick.partFile)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border-edge border-t bg-edge">
        <Field
          label="Colour"
          sub={`code ${brick.colorCode}`}
          value={colorName(brick.colorCode)}
        />
        <Field label="Category" value={brick.category ?? "Unlisted"} />
        <Field label="Submodel" value={submodel} />
        <Field
          label="Step"
          sub={totalBags > 1 ? `bag ${brick.bag + 1}` : undefined}
          value={`${brick.step + 1} / ${totalSteps}`}
        />
      </dl>

      <div className="border-edge border-t px-3 py-2">
        <button
          className="hud-button w-full"
          onClick={() => onGoToStep(brick.step)}
          type="button"
        >
          Go to its step
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-panel px-3 py-2">
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate text-ink text-xs" title={value}>
        {value}
      </dd>
      {sub ? <dd className="readout mt-0.5 text-faint">{sub}</dd> : null}
    </div>
  );
}
