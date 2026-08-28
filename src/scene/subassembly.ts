import { contactHeight, type Standing } from "./heightField";

/**
 * What is holding up what.
 *
 * A build is a pile of independent placements right up until you try to take
 * one out of the middle of it, at which point it matters very much that the
 * roof was standing on the wall. LDraw carries no connectivity data, so the
 * same trick the snapping uses works here: a part rests on another when the
 * height that other part would hold it at is the height it is actually at.
 * Everything else follows from that one relation.
 *
 * Only vertical contact counts, which is also what a real brick does. Two
 * bricks side by side at the same level share an edge and nothing else, and
 * pulling one out leaves the other exactly where it was.
 */

/** Contact this far out is still contact; anything more is a gap. */
const TOUCH_EPSILON = 0.5;

export interface Links {
  /** For each part, the parts it is holding up. */
  over: Map<number, Set<number>>;
  /** For each part, the parts holding it up. Empty means nothing is. */
  under: Map<number, Set<number>>;
}

/** True when `upper`, where it stands, is sitting on `lower`. */
export function restsOn(upper: Standing, lower: Standing): boolean {
  const rest = contactHeight(
    upper.profile,
    upper.position.x,
    upper.position.z,
    lower
  );
  return rest !== null && Math.abs(rest - upper.position.y) <= TOUCH_EPSILON;
}

/**
 * Every contact in the build, both ways round.
 *
 * Every pair, which is a square in the number of parts. Two things keep that
 * honest: it runs when somebody clicks rather than every frame, and a pair
 * whose footprints do not overlap costs a walk over one part's columns and
 * nothing else.
 */
export function linksBetween(built: Map<number, Standing>): Links {
  const links: Links = { over: new Map(), under: new Map() };
  for (const id of built.keys()) {
    links.over.set(id, new Set());
    links.under.set(id, new Set());
  }

  for (const [upperId, upper] of built) {
    for (const [lowerId, lower] of built) {
      if (upperId === lowerId || !restsOn(upper, lower)) {
        continue;
      }
      links.under.get(upperId)?.add(lowerId);
      links.over.get(lowerId)?.add(upperId);
    }
  }
  return links;
}

/**
 * A part, and everything that would be left hanging without it.
 *
 * Taking a brick out from under a stack should bring the stack, because that is
 * what taking it out would do to the stack anyway. A part with another support
 * still under it stays where it is: the point is the load, not the contact, so
 * pulling one leg out from under a bridge leaves the bridge on its other leg.
 *
 * A part resting on nothing at all is left alone. It is standing on its own
 * already, and would go on doing so.
 */
export function loadBearing(seed: number, links: Links): Set<number> {
  const taken = new Set([seed]);
  const queue = [seed];

  while (queue.length > 0) {
    const id = queue.pop() as number;
    for (const above of links.over.get(id) ?? []) {
      if (taken.has(above) || standsWithout(above, links, taken)) {
        continue;
      }
      taken.add(above);
      queue.push(above);
    }
  }
  return taken;
}

/** True while this part has something under it that is not being taken. */
function standsWithout(id: number, links: Links, taken: Set<number>): boolean {
  const supports = links.under.get(id);
  // Nothing under it at all: it was standing on its own, and still is.
  if (!supports || supports.size === 0) {
    return true;
  }
  for (const support of supports) {
    if (!taken.has(support)) {
      return true;
    }
  }
  return false;
}

/**
 * Everything joined to a part, in either direction.
 *
 * This is the whole thing you would pick up if you reached into a finished
 * model and lifted: not the part, and not what it happens to be holding, but
 * the piece of the build it belongs to.
 */
export function connectedTo(seed: number, links: Links): Set<number> {
  const found = new Set([seed]);
  const queue = [seed];

  while (queue.length > 0) {
    const id = queue.pop() as number;
    for (const neighbours of [links.over.get(id), links.under.get(id)]) {
      for (const next of neighbours ?? []) {
        if (found.has(next)) {
          continue;
        }
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}
