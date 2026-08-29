import { NextResponse } from "next/server";
import { analyze } from "../../../../scripts/lib/ldraw-analyze.mjs";
// The packer is plain ESM in scripts/ so the CLI and this route share one
// implementation; there is no second copy of the resolution rules to drift.
import { packModel } from "../../../../scripts/lib/ldraw-pack.mjs";
import { compressedJson } from "../../../server/compressed-json";
import { getResolver } from "../../../server/parts-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 24 MB. Comfortably above the largest official set, well below a DoS. */
const MAX_BYTES = 24 * 1024 * 1024;

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

  try {
    const { concurrency, resolve } = await getResolver();

    // Drop unresolvable parts instead of refusing the file. Refusing leaves
    // the person with an error and no way to act on it, when the other 4,000
    // bricks would have built fine.
    const result = (await packModel({
      concurrency,
      name,
      resolve,
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

    return await compressedJson(request, {
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
