export type Rapier = typeof import("@dimforge/rapier3d-compat");

let loaded: Rapier | null = null;
let loading: Promise<Rapier | null> | null = null;

/**
 * Load the physics engine.
 *
 * It is a WebAssembly module of some size, so it is imported on demand rather
 * than bundled into the entry chunk. A failure here is not fatal for the watch
 * flow: the pour falls back to a scripted drop. Build mode needs it, and says
 * so rather than pretending.
 */
export function loadPhysics(): Promise<Rapier | null> {
  loading ??= import("@dimforge/rapier3d-compat")
    .then(async (module) => {
      await module.init();
      loaded = module;
      return module;
    })
    .catch((error) => {
      console.warn(
        "[ldraw] physics unavailable, falling back to a scripted drop",
        error
      );
      return null;
    });
  return loading;
}

/** The module once `loadPhysics` has resolved, or null before that. */
export function getPhysics(): Rapier | null {
  return loaded;
}

/**
 * Seconds a brick takes to fall from the release height, which is what gravity
 * is derived from.
 *
 * There is a floor on how short this can be. A fall compressed into a dozen
 * frames arrives before the speed has visibly changed, so it reads as constant
 * velocity even though the solver is accelerating it correctly. Around half a
 * second of fall is what it takes to actually see the acceleration.
 */
const FALL_SECONDS = 0.72;

/**
 * Gravity for a world measured in LDraw units.
 *
 * LDraw units are 0.4mm, so real gravity would be about 24,500 units per second
 * squared and a drop would be over before anyone saw it. Deriving it from the
 * release height instead means a brick takes the same time to fall whatever the
 * model's scale.
 */
export function gravityFor(dropHeight: number): number {
  return (2 * dropHeight) / (FALL_SECONDS * FALL_SECONDS);
}

/** Barely any bounce: ABS on a table does not bounce much. */
export const BRICK_RESTITUTION = 0.05;
export const BRICK_FRICTION = 1.1;
export const BRICK_DENSITY = 0.002;
