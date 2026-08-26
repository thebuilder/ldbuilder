import { ImageResponse } from "next/og";

export const alt =
  "LDraw Builder: watch a LEGO model assemble itself, one build step at a time";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

/**
 * Rendered once at build time by next/og. Kept to layout primitives and system
 * fonts so it needs no font fetch and no external asset.
 */
export default function OpenGraphImage() {
  const brick = (color: string, x: number, y: number, w: number, h: number) => (
    <div
      key={`${x}-${y}`}
      style={{
        background: color,
        borderRadius: 4,
        height: h,
        left: x,
        position: "absolute",
        top: y,
        width: w,
      }}
    />
  );

  return new ImageResponse(
    <div
      style={{
        background: "#0e0f12",
        color: "#eceef2",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: 72,
        position: "relative",
        width: "100%",
      }}
    >
      {/* Loose bricks, echoing the floor the models are tipped onto. */}
      {brick("#1c6bd6", 820, 96, 132, 44)}
      {brick("#e3000b", 980, 168, 88, 44)}
      {brick("#8d95a2", 792, 214, 108, 36)}
      {brick("#f5c518", 946, 268, 72, 36)}
      {brick("#1c6bd6", 838, 322, 96, 36)}
      {brick("#e3000b", 992, 384, 116, 44)}
      {brick("#8d95a2", 858, 442, 80, 36)}

      <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
        <div style={{ background: "#e3000b", height: 22, width: 22 }} />
        <div style={{ background: "#f5c518", height: 22, width: 22 }} />
        <div style={{ background: "#0057a6", height: 22, width: 22 }} />
        <div style={{ fontSize: 28, letterSpacing: 8, marginLeft: 10 }}>
          LDRAW BUILDER
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
        <div style={{ fontSize: 62, letterSpacing: -1, lineHeight: 1.12 }}>
          Tip the bricks onto the floor and watch a model assemble itself.
        </div>
        <div
          style={{
            color: "#b3bac6",
            fontSize: 27,
            lineHeight: 1.4,
            marginTop: 26,
          }}
        >
          LDraw models in the browser. Follow the build step by step, explode
          it, slice it open, or click any brick.
        </div>
      </div>

      <div style={{ color: "#8d95a2", display: "flex", fontSize: 21, gap: 40 }}>
        <div>Build order</div>
        <div>Explode</div>
        <div>Layer slice</div>
        <div>Part inspector</div>
      </div>
    </div>,
    size
  );
}
