import path from "node:path";
import { NextResponse } from "next/server";
// The packer is plain ESM in scripts/ so the CLI and this route share one
// implementation; there is no second copy of the resolution rules to drift.
import { analyze } from "../../../../../scripts/lib/ldraw-analyze.mjs";
import {
  buildLibraryIndex,
  packModel,
} from "../../../../../scripts/lib/ldraw-pack.mjs";
import { fetchSet, normalizeSetId } from "../../../../../scripts/lib/omr.mjs";

export const runtime = "nodejs";
/** Indexing 36k files takes a second; never prerender or cache this route. */
export const dynamic = "force-dynamic";

// The library is a developer-installed folder read at request time. It must
// never be traced into the deployment output: it is 36k files.
const LIBRARY_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "ldraw-library"
);

/** `928`, `928-1` and `21309-1` are all acceptable; anything else is not. */
const SET_ID = /^\d{2,8}(-\d{1,2})?$/;
const VARIANT_SUFFIX = /-\d+$/;
const NOT_IN_OMR = /not in the OMR/;

interface LibraryIndex {
  index: Map<string, string>;
}

/** What `readMetadata` in scripts/lib/omr.mjs returns. */
interface OmrMetadata {
  author: string | null;
  keywords: string | null;
  license: string | null;
  redistributable: boolean;
  theme: string | null;
}

let indexPromise: Promise<LibraryIndex> | null = null;

function getIndex(): Promise<LibraryIndex> {
  indexPromise ??= buildLibraryIndex(LIBRARY_DIR) as Promise<LibraryIndex>;
  return indexPromise;
}

/**
 * Open any set from the LDraw Official Model Repository by number.
 *
 * The OMR serves no CORS headers, so a browser cannot fetch these directly;
 * this route is the proxy. It also packs the set against the local parts
 * library on the way through, which is the same work `pnpm ldraw:pack` does for
 * the bundled models.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ set: string }> }
): Promise<Response> {
  const { set } = await context.params;

  if (!SET_ID.test(set)) {
    return NextResponse.json(
      { error: `"${set}" is not a set number. Try 928 or 21309.` },
      { status: 400 }
    );
  }

  let index: Map<string, string>;
  try {
    ({ index } = await getIndex());
  } catch {
    indexPromise = null;
    return NextResponse.json(
      { error: libraryMissingMessage() },
      { status: 503 }
    );
  }
  if (index.size === 0) {
    indexPromise = null;
    return NextResponse.json(
      { error: libraryMissingMessage() },
      { status: 503 }
    );
  }

  const setId = normalizeSetId(set);

  try {
    const { text, metadata } = (await fetchSet(setId)) as {
      text: string;
      metadata: OmrMetadata;
    };

    if (!metadata.redistributable) {
      return NextResponse.json(
        { error: `Set ${setId} carries no redistribution licence.` },
        { status: 403 }
      );
    }

    const result = (await packModel({
      index,
      name: `${setId}.mpd`,
      skipMissing: true,
      text,
    })) as {
      mpd: string;
      partNames: Record<string, string>;
      missing: string[];
    };

    const { bricks } = analyze(result.mpd) as { bricks: number };
    if (bricks === 0) {
      return NextResponse.json(
        {
          error: `None of the parts in set ${setId} could be matched to the installed library.`,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      author: metadata.author,
      bricks,
      missing: result.missing,
      mpd: result.mpd,
      partNames: result.partNames,
      setId,
      theme: metadata.theme,
      title: setId.replace(VARIANT_SUFFIX, ""),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not open that set.";
    // A set that simply is not in the OMR is a 404, not a server fault.
    const status = NOT_IN_OMR.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function libraryMissingMessage(): string {
  return "This server does not have the LDraw parts library available, so official sets cannot have their parts resolved.";
}
