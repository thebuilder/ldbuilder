import { describe, expect, it } from "vitest";
import {
  groupByText,
  lockfileNames,
  missingText,
  parseLicenceList,
  platformFamilies,
  renderNotices,
} from "./notices.mjs";

const pkg = (over = {}) => ({
  homepage: null,
  license: "MIT",
  name: "thing",
  path: "/tmp/thing",
  text: "MIT License\n\nCopyright (c) Someone",
  version: "1.0.0",
  ...over,
});

const render = (over = {}) =>
  renderNotices({
    families: new Map(),
    packages: [pkg()],
    usesNextImage: false,
    ...over,
  });

describe("parseLicenceList", () => {
  it("flattens pnpm's licence-keyed groups into packages", () => {
    const packages = parseLicenceList({
      "Apache-2.0": [
        { name: "rapier", paths: ["/x/rapier"], versions: ["0.20.0"] },
      ],
      MIT: [{ name: "three", paths: ["/x/three"], versions: ["0.185.1"] }],
    });

    expect(packages).toHaveLength(2);
    expect(packages[0]).toMatchObject({
      license: "Apache-2.0",
      name: "rapier",
      version: "0.20.0",
    });
  });

  it("sorts by name, so a regenerated file diffs cleanly", () => {
    const packages = parseLicenceList({
      MIT: [{ name: "zzz" }, { name: "aaa" }, { name: "mmm" }],
    });

    expect(packages.map((p) => p.name)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("survives a package with no paths, versions or homepage", () => {
    const [only] = parseLicenceList({ MIT: [{ name: "bare" }] });

    expect(only).toMatchObject({ homepage: null, path: null, version: "" });
  });
});

describe("lockfileNames", () => {
  it("reads package names without their version suffix", () => {
    const names = lockfileNames(
      [
        "packages:",
        "  three@0.185.1:",
        "  '@next/swc-darwin-arm64@16.3.3':",
      ].join("\n")
    );

    expect(names.has("three")).toBe(true);
    expect(names.has("@next/swc-darwin-arm64")).toBe(true);
  });
});

describe("platformFamilies", () => {
  const lock = new Set([
    "@img/sharp-darwin-arm64",
    "@img/sharp-linux-x64",
    "@img/sharp-win32-x64",
    "@img/sharp-libvips-darwin-arm64",
    "@img/sharp-libvips-linux-x64",
    "three",
  ]);

  it("finds the siblings a deployment would install instead", () => {
    const families = platformFamilies(
      [pkg({ license: "Apache-2.0", name: "@img/sharp-darwin-arm64" })],
      lock
    );

    expect(families.get("@img/sharp-").siblings).toEqual([
      "@img/sharp-darwin-arm64",
      "@img/sharp-linux-x64",
      "@img/sharp-win32-x64",
    ]);
  });

  it("does not let sharp swallow sharp-libvips, which is a different licence", () => {
    // The two families differ in licence: Apache-2.0 against LGPL. Matching on
    // startsWith merges them and reports the wrong terms for ten packages.
    const families = platformFamilies(
      [
        pkg({ name: "@img/sharp-darwin-arm64" }),
        pkg({ name: "@img/sharp-libvips-darwin-arm64" }),
      ],
      lock
    );

    expect(families.get("@img/sharp-").siblings).toHaveLength(3);
    expect(families.get("@img/sharp-libvips-").siblings).toEqual([
      "@img/sharp-libvips-darwin-arm64",
      "@img/sharp-libvips-linux-x64",
    ]);
  });

  it("ignores a package that is not platform-specific", () => {
    expect(platformFamilies([pkg({ name: "three" })], lock).size).toBe(0);
  });

  it("ignores a lone variant, which has no family to report", () => {
    const families = platformFamilies(
      [pkg({ name: "@only/thing-linux-x64" })],
      new Set(["@only/thing-linux-x64"])
    );

    expect(families.size).toBe(0);
  });
});

describe("groupByText", () => {
  it("reproduces two MIT copyright lines separately", () => {
    const groups = groupByText([
      pkg({ name: "a", text: "MIT, (c) Alice" }),
      pkg({ name: "b", text: "MIT, (c) Bob" }),
    ]);

    expect(groups.size).toBe(2);
  });

  it("reproduces one shared Apache text once", () => {
    const groups = groupByText([
      pkg({ license: "Apache-2.0", name: "a", text: "Apache boilerplate" }),
      pkg({ license: "Apache-2.0", name: "b", text: "Apache boilerplate" }),
    ]);

    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });

  it("skips packages that ship no text, which have nothing to reproduce", () => {
    expect(groupByText([pkg({ text: null })]).size).toBe(0);
  });
});

describe("missingText", () => {
  it("picks out the packages shipping no licence file", () => {
    const missing = missingText([
      pkg({ name: "a" }),
      pkg({ name: "b", text: null }),
    ]);

    expect(missing.map((p) => p.name)).toEqual(["b"]);
  });
});

describe("renderNotices", () => {
  it("points at LICENSE for the parts library, which is not a dependency", () => {
    expect(render()).toContain("[LICENSE](LICENSE)");
  });

  it("counts the packages and names every licence it found", () => {
    const text = render({
      packages: [pkg({ license: "MIT" }), pkg({ license: "Apache-2.0" })],
    });

    expect(text).toContain("2 packages, under: Apache-2.0, MIT.");
  });

  it("reproduces the licence text, which is the point of the file", () => {
    expect(render()).toContain("Copyright (c) Someone");
  });

  it("links a homepage when there is one, and does not invent one otherwise", () => {
    expect(
      render({ packages: [pkg({ homepage: "https://x.dev" })] })
    ).toContain("[thing](https://x.dev)");
    expect(render()).toContain("| `thing` |");
  });

  it("omits the platform section when nothing is platform-specific", () => {
    expect(render()).not.toContain("## Platform-specific binaries");
  });

  it("names the whole family, not just what is installed here", () => {
    const families = new Map([
      [
        "@img/sharp-",
        {
          installed: pkg({ name: "@img/sharp-darwin-arm64" }),
          license: "Apache-2.0",
          siblings: ["@img/sharp-darwin-arm64", "@img/sharp-linux-x64"],
        },
      ],
    ]);

    const text = render({ families });
    expect(text).toContain("`@img/sharp-*`");
    expect(text).toContain("`@img/sharp-linux-x64`");
  });

  it("omits the copyleft section when everything is permissive", () => {
    expect(render()).not.toContain("## Copyleft dependencies");
  });

  it("calls out copyleft rather than burying it in the table", () => {
    const text = render({
      packages: [pkg({ license: "LGPL-3.0-or-later", name: "libvips" })],
    });

    expect(text).toContain("## Copyleft dependencies");
    expect(text).toContain("`libvips` 1.0.0 — LGPL-3.0-or-later");
  });

  it("states the next/image finding as checked, either way", () => {
    const copyleft = [pkg({ license: "LGPL-3.0-or-later" })];

    expect(render({ packages: copyleft })).toContain(
      "imports `next/image` nowhere"
    );
    expect(render({ packages: copyleft, usesNextImage: true })).toContain(
      "does import `next/image`"
    );
  });

  it("ends with a single trailing newline, so the file is stable on rewrite", () => {
    const text = render();

    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
