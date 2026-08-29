// Static analysis of a packed .mpd: how many bricks, how many build steps.
//
// This mirrors the runtime brick predicate in src/ldraw/flatten.ts. Counting
// twice, once here and once in the browser, is what catches a flatten pass that
// drops or double-counts parts: the two numbers stop matching.

import { normalizeRef } from "./ldraw-pack.mjs";

const splitLines = (text) => text.split(LINE_BREAK);
const REF_LINE = /^1\s+\S+(?:\s+\S+){12}\s+(.+)$/;
const LINE_BREAK = /\r\n|\r|\n/;
const FILE_DIRECTIVE = /^0\s+FILE\s+(.+)$/i;
const LDRAW_ORG_DIRECTIVE = /^0\s+!LDRAW_ORG\s+(\S+)/i;
const UNOFFICIAL_PREFIX = /^Unofficial_/i;
const STEP_DIRECTIVE = /^0\s+STEP\b/i;

function readMpd(text) {
  const files = new Map();
  const order = [];
  let current = null;
  let buffer = [];
  for (const line of splitLines(text)) {
    const match = FILE_DIRECTIVE.exec(line.trim());
    if (match) {
      if (current !== null) {
        files.set(current, buffer.join("\n"));
      }
      current = normalizeRef(match[1]).toLowerCase();
      order.push(current);
      buffer = [];
      continue;
    }
    if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) {
    files.set(current, buffer.join("\n"));
  }
  return { files, root: order[0] };
}

/**
 * The `0 !LDRAW_ORG` header declares what a file is: "Part", "Subpart",
 * "Primitive", "Shortcut", "Unofficial_Part", and so on.
 *
 * Takes only the FIRST token after the directive, matching LDrawLoader
 * (`type = lp.getToken()`), and defaults to "Model" for files with no header,
 * also matching. The two have to agree, or the pack-time brick count stops
 * being a check on the runtime one.
 */
function declaredType(body) {
  for (const line of splitLines(body)) {
    const match = LDRAW_ORG_DIRECTIVE.exec(line.trim());
    if (match) {
      return match[1].replace(UNOFFICIAL_PREFIX, "").toLowerCase();
    }
  }
  return "model";
}

const isBrickType = (type) => type === "part" || type === "shortcut";
export function analyze(text) {
  const { files, root } = readMpd(text);
  let bricks = 0;
  const partUse = new Map();

  // Mirror LDrawLoader.computeBuildingSteps: a `0 STEP` only opens a new step
  // once something actually follows it, so a trailing STEP at end of file does
  // not count. The loader's depth-first traverse visits groups in document
  // order, which is what this recursion reproduces.
  let stepNumber = 0;
  let pendingStep = false;

  /**
   * Count one reference. Returns the key to descend into, or null when the
   * reference is a brick (matching stops descent: a Shortcut contains real Part
   * files, so descending would count the same brick twice) or unresolvable.
   */
  const countReference = (ref) => {
    const childKey = normalizeRef(ref).toLowerCase();
    const childBody = files.get(childKey);
    const type = childBody === undefined ? null : declaredType(childBody);

    if (type !== null && isBrickType(type)) {
      bricks += 1;
      partUse.set(childKey, (partUse.get(childKey) ?? 0) + 1);
      return null;
    }
    return childBody === undefined ? null : childKey;
  };

  const visit = (key, depth) => {
    if (depth > 64) {
      return; // pathological self-reference guard
    }
    const body = files.get(key);
    if (body === undefined) {
      return;
    }

    for (const rawLine of splitLines(body)) {
      const line = rawLine.trim();
      if (STEP_DIRECTIVE.test(line)) {
        pendingStep = true;
        continue;
      }

      const match = REF_LINE.exec(line);
      if (!match) {
        continue;
      }

      if (pendingStep) {
        stepNumber += 1;
        pendingStep = false;
      }

      const descendInto = countReference(match[1]);
      if (descendInto !== null) {
        visit(descendInto, depth + 1);
      }
    }
  };

  visit(root, 0);
  return { bricks, root, steps: stepNumber + 1, uniqueParts: partUse.size };
}
