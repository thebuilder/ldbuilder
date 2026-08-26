import type { LineSegments, Mesh, Object3D } from "three";

/**
 * Type guards for three.js subclasses.
 *
 * three marks its subclasses with `isMesh: true` and friends, and the usual
 * idiom is to cast and then read the flag. That tells TypeScript the property
 * is the literal `true`, so every such check reads as statically redundant even
 * though it is the whole point. Testing a `Partial` keeps the runtime check and
 * narrows the type properly.
 */
export function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

export function isLineSegments(object: Object3D): object is LineSegments {
  return (object as Partial<LineSegments>).isLineSegments === true;
}
