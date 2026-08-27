// Picks how the API routes resolve LDraw part references.
//
// Locally there is a checked-out parts library (`pnpm ldraw:setup`), and reading
// 36k files off disk is as fast as it gets. A deployment has no library, because
// 612MB of parts cannot ride along in a serverless function, so it falls back to
// fetching individual parts from library.ldraw.org.
//
// Both produce byte-identical packed output. The only difference is that the
// network path costs a few seconds on a cold set, which is what the routes'
// cache headers are for.

import path from "node:path";
import {
  buildLibraryIndex,
  localResolver,
} from "../../scripts/lib/ldraw-pack.mjs";
import {
  networkResolver,
  REMOTE_CONCURRENCY,
} from "../../scripts/lib/ldraw-remote.mjs";

/** Looks up one normalized reference, returning its text or null. */
export type Resolve = (key: string) => Promise<string | null>;

export interface ResolverChoice {
  /** How many references this source is happy to be asked for at once. */
  concurrency: number;
  resolve: Resolve;
  /** Which backing store answered, for logging and for the debug endpoint. */
  source: "library" | "network";
}

// The library folder is read at request time and must never be traced into the
// deployment output. The ignore comment tells Turbopack to leave the path alone.
const LIBRARY_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "ldraw-library"
);

/**
 * Parts fetched over the network, shared across every request this instance
 * serves. Sets overlap heavily in their parts, so a warm instance packing its
 * second set does far less work than its first.
 */
const partCache = new Map<string, string | null>();

let choicePromise: Promise<ResolverChoice> | null = null;

function remote(): ResolverChoice {
  return {
    concurrency: REMOTE_CONCURRENCY as number,
    resolve: networkResolver({ cache: partCache }) as Resolve,
    source: "network",
  };
}

async function choose(): Promise<ResolverChoice> {
  // Set LDRAW_PARTS_SOURCE=network to exercise the deployment path on a
  // machine that does have the library installed.
  if (process.env.LDRAW_PARTS_SOURCE === "network") {
    return remote();
  }
  try {
    const { index } = (await buildLibraryIndex(LIBRARY_DIR)) as {
      index: Map<string, string>;
    };
    if (index.size > 0) {
      return {
        // Local reads are cheap; this is only here to bound open file handles.
        concurrency: 24,
        resolve: localResolver(index) as Resolve,
        source: "library",
      };
    }
  } catch {
    // No library here, which is the normal case in production.
  }
  return remote();
}

/** Resolve once per process; walking the library is not free. */
export function getResolver(): Promise<ResolverChoice> {
  choicePromise ??= choose();
  return choicePromise;
}
