import { colorHex, isTranslucent } from "@/ldraw/colors.generated";

export interface StudIconProps {
  colorCode: number;
  /** Footprint in studs, as the part's description states it. */
  size: number[];
}

/**
 * A part, drawn as its studs.
 *
 * Rendering 194 little three.js previews to fill an inventory would cost more
 * than the scene behind it. What a person is actually scanning for is the
 * footprint and the colour, and a grid of dots carries both at eight pixels a
 * side. Parts with no stated footprint, like a wheel, get a plain tile.
 */
export function StudIcon({ colorCode, size }: StudIconProps) {
  const [width = 0, depth = 0] = size;
  const columns = Math.min(Math.max(width, 1), 6);
  const rows = Math.min(Math.max(depth, 1), 6);
  const known = width > 0 && depth > 0;

  const hex = colorHex(colorCode);
  const pitch = 4;
  const boxWidth = columns * pitch;
  const boxHeight = rows * pitch;
  const studs: { cx: number; cy: number; key: string }[] = [];
  if (known) {
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        studs.push({
          cx: column * pitch + pitch / 2,
          cy: row * pitch + pitch / 2,
          key: `${column}-${row}`,
        });
      }
    }
  }

  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
      focusable="false"
      viewBox={`-0.5 -0.5 ${boxWidth + 1} ${boxHeight + 1}`}
    >
      <rect
        fill={hex}
        fillOpacity={isTranslucent(colorCode) ? 0.55 : 1}
        height={boxHeight}
        rx={0.6}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={0.4}
        width={boxWidth}
        x={0}
        y={0}
      />
      {studs.map((stud) => (
        <circle
          cx={stud.cx}
          cy={stud.cy}
          fill="rgba(255,255,255,0.28)"
          key={stud.key}
          r={pitch * 0.28}
          stroke="rgba(0,0,0,0.3)"
          strokeWidth={0.25}
        />
      ))}
    </svg>
  );
}
