import { ImageResponse } from "next/og";

export const alt =
  "LDBuilder: watch a LEGO model build itself, then build one yourself";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

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

      <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
        <div style={{ fontSize: 68, letterSpacing: -1, lineHeight: 1.1 }}>
          Watch it build itself.
        </div>
        <div
          style={{
            color: "#b3bac6",
            fontSize: 68,
            letterSpacing: -1,
            lineHeight: 1.1,
          }}
        >
          Then build it yourself.
        </div>
      </div>

      <div style={{ color: "#8d95a2", display: "flex", fontSize: 23 }}>
        LDraw models, in the browser.
      </div>
    </div>,
    size
  );
}
