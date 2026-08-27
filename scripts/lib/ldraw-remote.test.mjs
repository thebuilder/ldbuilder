import { describe, expect, it, vi } from "vitest";
import { networkResolver } from "./ldraw-remote.mjs";

const MIRROR = "https://cdn.jsdelivr.net";
const ORIGIN = "https://library.ldraw.org";

const ok = (body) => new Response(body, { status: 200 });
const notFound = () => new Response("", { status: 404 });
const rateLimited = () => new Response("", { status: 429 });

/** Serve only the URLs listed; everything else 404s. Records what was tried. */
function fakeNetwork(routes) {
  const tried = [];
  const fetchImpl = vi.fn((url) => {
    tried.push(url);
    const body = routes[url];
    return Promise.resolve(body === undefined ? notFound() : ok(body));
  });
  return { fetchImpl, tried };
}

describe("networkResolver candidate order", () => {
  it("prefers the mirror, so the rate-limited origin is spared", async () => {
    const net = fakeNetwork({
      [`${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/parts/3001.dat`]:
        "0 Brick  2 x  4",
    });

    await expect(networkResolver(net)("3001.dat")).resolves.toBe(
      "0 Brick  2 x  4"
    );
    expect(net.tried).toHaveLength(1);
    expect(net.tried[0]).toContain("cdn.jsdelivr.net");
  });

  it("falls back to the origin for parts the mirror snapshot lacks", async () => {
    const net = fakeNetwork({
      [`${ORIGIN}/library/official/parts/99999.dat`]: "0 New Part",
    });

    await expect(networkResolver(net)("99999.dat")).resolves.toBe("0 New Part");
    expect(net.tried.at(-1)).toContain("library.ldraw.org");
  });

  it("searches parts/ then p/ then models/, as the loader does", async () => {
    const net = fakeNetwork({});
    await networkResolver(net)("stud.dat");

    const mirrorPaths = net.tried
      .filter((url) => url.startsWith(MIRROR))
      .map((url) => url.split("/complete/ldraw/")[1]);
    expect(mirrorPaths).toEqual([
      "parts/stud.dat",
      "p/stud.dat",
      "models/stud.dat",
    ]);
  });

  it("treats a name already under a search directory as a complete path", async () => {
    const net = fakeNetwork({});
    await networkResolver(net)("parts/s/3001s01.dat");

    const mirrorPaths = net.tried.filter((url) => url.startsWith(MIRROR));
    expect(mirrorPaths).toHaveLength(1);
    expect(mirrorPaths[0]).toContain("/complete/ldraw/parts/s/3001s01.dat");
  });

  it("searches for 8/ names, which the loader leaves unrewritten", async () => {
    // 8/3-8cyli.dat lives at p/8/3-8cyli.dat. Treating the name as a complete
    // path made these the only unresolved references in three real sets.
    const net = fakeNetwork({
      [`${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/p/8/3-8cyli.dat`]:
        "0 Cylinder",
    });

    await expect(networkResolver(net)("8/3-8cyli.dat")).resolves.toBe(
      "0 Cylinder"
    );
  });

  it("tries the unofficial library last", async () => {
    const net = fakeNetwork({});
    await networkResolver(net)("3001.dat");

    expect(net.tried.at(-1)).toContain("/unofficial/");
  });

  it("returns null when nothing has the part", async () => {
    await expect(
      networkResolver(fakeNetwork({}))("nope.dat")
    ).resolves.toBeNull();
  });
});

describe("networkResolver error handling", () => {
  it("retries a rate-limited request instead of calling it a miss", async () => {
    // Caching a 429 as "part does not exist" silently produced models with
    // 136 parts missing, which looked exactly like genuine 404s.
    const url = `${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/parts/3001.dat`;
    let calls = 0;
    const fetchImpl = vi.fn((requested) => {
      if (requested !== url) {
        return Promise.resolve(notFound());
      }
      calls += 1;
      return Promise.resolve(calls === 1 ? rateLimited() : ok("0 Brick"));
    });

    await expect(networkResolver({ fetchImpl })("3001.dat")).resolves.toBe(
      "0 Brick"
    );
    expect(calls).toBe(2);
  });

  it("moves on to the next candidate when a request throws", async () => {
    const good = `${ORIGIN}/library/official/parts/3001.dat`;
    const fetchImpl = vi.fn((url) =>
      url === good
        ? Promise.resolve(ok("0 Brick"))
        : Promise.reject(new Error("socket hang up"))
    );

    await expect(networkResolver({ fetchImpl })("3001.dat")).resolves.toBe(
      "0 Brick"
    );
  });
});

describe("networkResolver caching", () => {
  it("serves a repeat lookup from cache", async () => {
    const net = fakeNetwork({
      [`${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/parts/3001.dat`]:
        "0 Brick",
    });
    const resolve = networkResolver(net);

    await resolve("3001.dat");
    await resolve("3001.dat");

    expect(net.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches a genuine miss, so it costs one candidate chain and not many", async () => {
    const net = fakeNetwork({});
    const resolve = networkResolver(net);

    await resolve("nope.dat");
    const afterFirst = net.fetchImpl.mock.calls.length;
    await resolve("nope.dat");

    expect(net.fetchImpl.mock.calls.length).toBe(afterFirst);
  });

  it("collapses concurrent lookups of the same part into one fetch", async () => {
    const net = fakeNetwork({
      [`${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/parts/3001.dat`]:
        "0 Brick",
    });
    const resolve = networkResolver(net);

    const results = await Promise.all([
      resolve("3001.dat"),
      resolve("3001.dat"),
      resolve("3001.dat"),
    ]);

    expect(results).toEqual(["0 Brick", "0 Brick", "0 Brick"]);
    expect(net.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares a caller-supplied cache across resolvers", async () => {
    // The API routes reuse one cache for the life of the instance, so a warm
    // function packing its second set reuses the first one's parts.
    const cache = new Map();
    const url = `${MIRROR}/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/parts/3001.dat`;
    const first = fakeNetwork({ [url]: "0 Brick" });
    await networkResolver({ ...first, cache })("3001.dat");

    const second = fakeNetwork({ [url]: "0 Brick" });
    await expect(
      networkResolver({ ...second, cache })("3001.dat")
    ).resolves.toBe("0 Brick");
    expect(second.fetchImpl).not.toHaveBeenCalled();
  });
});
