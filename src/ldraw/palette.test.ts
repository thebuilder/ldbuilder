// @vitest-environment jsdom
import type { Material, MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instantiate, loadPalette } from "./palette";

/**
 * A palette small enough to write down.
 *
 * One part, one triangle, one edge line, both in the colours LDraw uses to mean
 * "whatever colour I am given". That is the whole of what the loader has to get
 * right: geometry arrives once, and a colour is chosen per instance by
 * redirecting those two materials.
 */
const LDCONFIG = `
0 !COLOUR Main_Colour CODE 16 VALUE #FF8080 EDGE #333333
0 !COLOUR Edge_Colour CODE 24 VALUE #A0A0A0 EDGE #333333
0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333
0 !COLOUR Yellow CODE 14 VALUE #F2CD37 EDGE #333333
0 !COLOUR Black CODE 0 VALUE #1B2A34 EDGE #808080
`;

const PALETTE_MPD = `0 FILE palette.ldr
0 Free build palette
0 !LDRAW_ORG Model
1 16 0 0 0 1 0 0 0 1 0 0 0 1 3005.dat

0 FILE 3005.dat
0 Brick 1 x 1
0 !LDRAW_ORG Part
3 16 -10 0 -10 10 0 -10 10 24 10
2 24 -10 0 -10 10 0 -10
`;

const CATALOGUE = {
  groups: [
    {
      id: "brick",
      label: "Bricks",
      parts: [{ file: "3005.dat", name: "Brick 1 x 1", size: [1, 1] }],
    },
  ],
};

/**
 * A fetch that answers from the strings above.
 *
 * `Response` is real, because three's `FileLoader` reads the body as a stream
 * to report progress and a hand-rolled object does not have one. `Request` is
 * not: Node cannot build one from a relative URL, which is the only kind the
 * app asks for.
 */
function respond(body: string | object, ok = true): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(ok ? text : "", { status: ok ? 200 : 404 });
}

function serve(overrides: Record<string, Response> = {}): void {
  vi.stubGlobal(
    "Request",
    class FakeRequest {
      readonly url: string;
      constructor(url: string) {
        this.url = String(url);
      }
      toString(): string {
        return this.url;
      }
    }
  );

  vi.stubGlobal("fetch", (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : String((input as { url: string }).url);
    for (const [pattern, response] of Object.entries(overrides)) {
      if (url.includes(pattern)) {
        return Promise.resolve(response.clone());
      }
    }
    if (url.includes("LDConfig")) {
      return Promise.resolve(respond(LDCONFIG));
    }
    if (url.includes("palette.json")) {
      return Promise.resolve(respond(CATALOGUE));
    }
    if (url.includes("palette.mpd")) {
      return Promise.resolve(respond(PALETTE_MPD));
    }
    return Promise.resolve(respond("", false));
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPalette", () => {
  it("hands back the parts the catalogue names, grouped", async () => {
    serve();

    const palette = await loadPalette();

    expect(palette.groups).toHaveLength(1);
    expect(palette.groups[0].label).toBe("Bricks");
    expect(palette.groups[0].parts[0]).toMatchObject({
      file: "3005.dat",
      group: "brick",
      name: "Brick 1 x 1",
      size: [1, 1],
    });
  });

  it("measures each part, so it can be given a collider and snapped", async () => {
    serve();

    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");

    expect(part?.halfExtents.x).toBeCloseTo(10, 5);
    expect(part?.halfExtents.y).toBeCloseTo(12, 5);
    expect(part?.radius).toBeGreaterThan(0);
  });

  it("leaves the template unposed, so instances start from nothing", async () => {
    serve();

    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");

    expect(part?.template.position.toArray()).toEqual([0, 0, 0]);
    expect(part?.template.parent).toBeNull();
  });

  it("says so rather than rendering nothing when the pack is missing", async () => {
    serve({ "/parts/palette.mpd": respond("", false) });

    await expect(loadPalette()).rejects.toThrow(/pnpm ldraw:palette/);
  });

  it("skips a catalogue entry the pack does not contain", async () => {
    serve({
      "/parts/palette.json": respond({
        groups: [
          {
            id: "brick",
            label: "Bricks",
            parts: [
              { file: "3005.dat", name: "Brick 1 x 1", size: [1, 1] },
              { file: "9999.dat", name: "Not here", size: [1, 1] },
            ],
          },
        ],
      }),
    });

    const palette = await loadPalette();

    expect(palette.groups[0].parts).toHaveLength(1);
  });

  it("finds a material for a colour it knows, and none for one it does not", async () => {
    serve();

    const palette = await loadPalette();

    expect(palette.materials(4).surface).not.toBeNull();
    expect(palette.materials(4).edge).not.toBeNull();
    expect(palette.materials(9999).surface).toBeNull();
  });
});

/** The colour a mesh ends up drawn in, whichever shape its material is. */
function hexOf(material: Material | Material[]): string {
  const one = Array.isArray(material) ? material[0] : material;
  return (one as MeshStandardMaterial).color.getHexString();
}

describe("instantiate", () => {
  it("makes an instance that shares the template's geometry", async () => {
    serve();
    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");
    if (!part) {
      throw new Error("no part");
    }

    const brick = instantiate(part, 4, 7, palette);

    expect(brick.meshes[0].geometry).toBe(part.meshes[0].geometry);
    expect(brick.id).toBe(7);
    expect(brick.partFile).toBe("3005.dat");
    expect(brick.colorCode).toBe(4);
  });

  it("gives two instances of one part two different colours", async () => {
    serve();
    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");
    if (!part) {
      throw new Error("no part");
    }

    const red = instantiate(part, 4, 0, palette);
    const yellow = instantiate(part, 14, 1, palette);

    // What matters is the colour that comes out, not which object carries it.
    expect(hexOf(red.meshes[0].material)).toBe("c91a09");
    expect(hexOf(yellow.meshes[0].material)).toBe("f2cd37");
  });

  it("stamps its id on every mesh, so a click knows what it hit", async () => {
    serve();
    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");
    if (!part) {
      throw new Error("no part");
    }

    const brick = instantiate(part, 4, 3, palette);

    brick.object.traverse((child) => {
      expect(child.userData.brickId).toBe(3);
    });
  });

  it("leaves the template's own materials alone", async () => {
    serve();
    const palette = await loadPalette();
    const part = palette.byFile.get("3005.dat");
    if (!part) {
      throw new Error("no part");
    }
    const before = part.meshes[0].material;

    instantiate(part, 14, 0, palette);

    expect(part.meshes[0].material).toBe(before);
  });
});
