import { BoxGeometry, Mesh, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { orientation } from "./freeBuild";
import {
  COLUMN,
  contactHeight,
  lowestOf,
  type Profile,
  profileOf,
  profilesCollide,
} from "./heightField";

/**
 * Parts are measured in LDraw's own frame, where Y points down and the origin
 * is the stud plane, so a brick's body runs from 0 to 24 and its studs sit at
 * negative Y. Standing it up turns all of that over.
 */
const box = (min: number[], max: number[]): Mesh => {
  const geometry = new BoxGeometry(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2]
  );
  geometry.translate(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2
  );
  const mesh = new Mesh(geometry);
  mesh.updateMatrixWorld(true);
  return mesh;
};

const upright = () => orientation(0, 0, new Quaternion());

/** The column a point falls in, so a test can read one place on a part. */
const at = (profile: Profile, x: number, z: number) => {
  const col = Math.floor((x - profile.anchorX) / COLUMN);
  const row = Math.floor((z - profile.anchorZ) / COLUMN);
  const index = row * profile.cols + col;
  return { bottom: profile.bottom[index], top: profile.top[index] };
};

/** A solid 2 x 4 brick body. */
const solid = () => profileOf([box([-20, 0, -40], [20, 24, 40])], upright());

describe("profileOf", () => {
  it("measures a plain brick as one slab, upside down from how it is drawn", () => {
    const profile = solid();

    expect(profile.cols).toBe(4);
    expect(profile.rows).toBe(8);
    expect(at(profile, 0, 0).bottom).toBeCloseTo(-24, 6);
    expect(at(profile, 0, 0).top).toBeCloseTo(0, 6);
    expect(lowestOf(profile)).toBe(-24);
  });

  it("leaves studs out, so a brick stacks on the body below it", () => {
    const withStuds = profileOf(
      [box([-20, 0, -40], [20, 24, 40]), box([-6, -4, -6], [6, 0, 6])],
      upright()
    );

    // The stud stands 4 above the plane; if it counted, the top would be 4.
    expect(at(withStuds, 0, 0).top).toBeCloseTo(0, 6);
  });

  it("keeps an upstand that starts where the studs do but keeps going", () => {
    // A bracket: a plate with a wall standing up off the back of it. The wall
    // starts at the stud plane, so trimming everything above that plane loses
    // it entirely and the bracket comes out as a plain plate.
    const bracket = profileOf(
      [box([-20, 0, -20], [20, 8, 20]), box([-20, -80, 20], [20, 0, 28])],
      upright()
    );

    // Standing the part up turns Z over too, so the wall ends up at -24.
    expect(at(bracket, 0, -24).top).toBeCloseTo(80, 6);
    expect(at(bracket, 0, 0).top).toBeCloseTo(0, 6);
  });

  it("finds a stepped underside rather than the lowest point of the whole part", () => {
    // A bracket: full depth over half its length, shallow over the other half.
    const bracket = profileOf(
      [box([-20, 0, -20], [0, 24, 20]), box([0, 0, -20], [20, 8, 20])],
      upright()
    );

    expect(at(bracket, -15, 0).bottom).toBeCloseTo(-24, 6);
    expect(at(bracket, 15, 0).bottom).toBeCloseTo(-8, 6);
    expect(at(bracket, 15, 0).top).toBeCloseTo(0, 6);
  });

  it("finds a sloped top at each column rather than one height for the part", () => {
    const wedge = profileOf(
      [box([-20, 12, -20], [0, 24, 20]), box([0, 0, -20], [20, 24, 20])],
      upright()
    );

    expect(at(wedge, -15, 0).top).toBeCloseTo(-12, 6);
    expect(at(wedge, 15, 0).top).toBeCloseTo(0, 6);
  });

  it("catches the rim of a hollow brick, not just the ceiling of its cavity", () => {
    // Four walls and a closed top, which is what a brick actually is. The rim
    // is 4 units wide and never lands on a column centre, so only walking the
    // triangle edges finds it.
    const hollow = profileOf(
      [
        box([-20, 0, -40], [20, 4, 40]),
        box([-20, 0, -40], [-16, 24, 40]),
        box([16, 0, -40], [20, 24, 40]),
        box([-20, 0, -40], [20, 24, -36]),
        box([-20, 0, 36], [20, 24, 40]),
      ],
      upright()
    );

    expect(at(hollow, -18, 0).bottom).toBeCloseTo(-24, 6);
    expect(lowestOf(hollow)).toBeCloseTo(-24, 6);
    // The cavity really is empty, which is what lets a stud go into it.
    expect(at(hollow, -5, 0).bottom).toBeCloseTo(-4, 6);
  });
});

describe("contactHeight", () => {
  const support = {
    position: new Vector3(0, 24, 0),
    profile: solid(),
  };

  it("puts a brick on top of another one", () => {
    expect(contactHeight(solid(), 0, 0, support)).toBeCloseTo(48, 6);
  });

  it("is null when two parts do not share a column", () => {
    expect(contactHeight(solid(), 400, 0, support)).toBeNull();
  });

  it("takes the column that binds first, not the average", () => {
    const bracket = profileOf(
      [box([-20, 0, -20], [0, 24, 20]), box([0, 0, -20], [20, 8, 20])],
      upright()
    );

    // The shallow half is the one at positive local X, so putting the part to
    // the left of the support is what leaves the shallow half over it.
    const shallow = contactHeight(bracket, -20, 0, support);
    // The other way round, the deep half lands on it and sits a brick higher.
    const deep = contactHeight(bracket, 20, 0, support);

    expect(shallow).toBeCloseTo(32, 6);
    expect(deep).toBeCloseTo(48, 6);
  });
});

describe("profilesCollide", () => {
  const support = {
    position: new Vector3(0, 24, 0),
    profile: solid(),
  };

  it("does not count resting on something as colliding with it", () => {
    expect(profilesCollide(solid(), new Vector3(0, 48, 0), support)).toBe(
      false
    );
  });

  it("counts a part put through another one", () => {
    expect(profilesCollide(solid(), new Vector3(0, 36, 0), support)).toBe(true);
  });

  it("lets a part sit beside one it does not overlap", () => {
    expect(profilesCollide(solid(), new Vector3(40, 24, 0), support)).toBe(
      false
    );
  });
});
