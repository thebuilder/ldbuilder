import path from "node:path";
import { NextResponse } from "next/server";
import { analyze } from "../../../../scripts/lib/ldraw-analyze.mjs";
// The packer is plain ESM in scripts/ so the CLI and this route share one
// implementation; there is no second copy of the resolution rules to drift.
import {
  buildLibraryIndex,
  packModel,
} from "../../../../scripts/lib/ldraw-pack.mjs";

export const runtime = "nodejs";
/** Indexing 36k files takes a second; never prerender or cache this route. */
export const dynamic = "force-dynamic";

// The library is a developer-installed folder that is read at request time and
// must never be traced into the deployment output: it is 36k files. The ignore
// comment tells Turbopack to leave the path alone.
const LIBRARY_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "ldraw-library"
);

/** 24 MB. Comfortably above the largest official set, well below a DoS. */
const MAX_BYTES = 24 * 1024 * 1024;

interface LibraryIndex {
  index: Map<string, string>;
}

// Building the index walks the whole library, so do it once per process.
let indexPromise: Promise<LibraryIndex> | null = null;

function getIndex(): Promise<LibraryIndex> {
  indexPromise ??= buildLibraryIndex(LIBRARY_DIR) as Promise<LibraryIndex>;
  return indexPromise;
}

export async function POST(request: Request): Promise<Response> {
  let payload: { name?: unknown; text?: unknown };
  try {
    payload = (await request.json()) as { name?: unknown; text?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 }
    );
  }

  const name = typeof payload.name === "string" ? payload.name : "model.ldr";
  const text = typeof payload.text === "string" ? payload.text : null;

  if (text === null) {
    return NextResponse.json({ error: 'Missing "text".' }, { status: 400 });
  }
  if (text.length > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Model is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`,
      },
      { status: 413 }
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

  try {
    // Drop unresolvable parts instead of refusing the file. Refusing leaves
    // the person with an error and no way to act on it, when the other 4,000
    // bricks would have built fine.
    const result = (await packModel({
      index,
      name,
      skipMissing: true,
      text,
    })) as {
      mpd: string;
      partNames: Record<string, string>;
      missing: string[];
      stats: { files: number; bytes: number; skipped: number };
    };

    const { bricks } = analyze(result.mpd) as { bricks: number };
    if (bricks === 0) {
      return NextResponse.json(
        {
          error:
            "None of the parts in this model could be matched to the LDraw library, so there is nothing to build.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      bricks,
      bytes: result.stats.bytes,
      files: result.stats.files,
      missing: result.missing,
      mpd: result.mpd,
      partNames: result.partNames,
      skipped: result.stats.skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Packing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function libraryMissingMessage(): string {
  // No shell command here. Whoever dropped the file is not necessarily whoever
  // can install the library, and a build instruction is not something they can
  // act on from this page.
  return "This server does not have the LDraw parts library available, so a raw .ldr cannot have its parts resolved. A self-contained .mpd file will open without it.";
}
