import { NextResponse } from "next/server";
// The packer is plain ESM in scripts/ so the CLI and this route share one
// implementation; there is no second copy of the resolution rules to drift.
import { analyze } from "../../../../../scripts/lib/ldraw-analyze.mjs";
import { packModel } from "../../../../../scripts/lib/ldraw-pack.mjs";
import { fetchSet, normalizeSetId } from "../../../../../scripts/lib/omr.mjs";
import { compressedJson } from "../../../../server/compressed-json";
import { getResolver } from "../../../../server/parts-resolver";

export const runtime = "nodejs";
/**
 * Resolving a set over the network is roughly 400 lookups, about five seconds
 * cold. The default 10s ceiling leaves no headroom for a large set.
 */
export const maxDuration = 60;

/** `928`, `928-1` and `21309-1` are all acceptable; anything else is not. */
const SET_ID = /^\d{2,8}(-\d{1,2})?$/;
const VARIANT_SUFFIX = /-\d+$/;
const NOT_IN_OMR = /not in the OMR/;

/**
 * A published set never changes, so the packed result is worth caching for a
 * long time. This is what keeps the network resolver viable: only the first
 * request for a set pays for it, everything after is a CDN hit.
 */
const IMMUTABLE = "public, s-maxage=31536000, max-age=3600, immutable";

/** What `readMetadata` in scripts/lib/omr.mjs returns. */
interface OmrMetadata {
  author: string | null;
  keywords: string | null;
  license: string | null;
  redistributable: boolean;
  theme: string | null;
}

/**
 * Open any set from the LDraw Official Model Repository by number.
 *
 * The OMR serves no CORS headers, so a browser cannot fetch these directly;
 * this route is the proxy. It also packs the set on the way through, which is
 * the same work `pnpm ldraw:pack` does for the bundled models, against whichever
 * parts source this deployment has.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ set: string }> }
): Promise<Response> {
  const { set } = await context.params;

  if (!SET_ID.test(set)) {
    return NextResponse.json(
      { error: `"${set}" is not a set number. Try 928 or 21309.` },
      { status: 400 }
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

    const { concurrency, resolve } = await getResolver();
    const result = (await packModel({
      concurrency,
      name: `${setId}.mpd`,
      resolve,
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
        { error: `None of the parts in set ${setId} could be resolved.` },
        { status: 422 }
      );
    }

    return await compressedJson(
      request,
      {
        author: metadata.author,
        bricks,
        missing: result.missing,
        mpd: result.mpd,
        partNames: result.partNames,
        setId,
        theme: metadata.theme,
        title: setId.replace(VARIANT_SUFFIX, ""),
      },
      { headers: { "cache-control": IMMUTABLE } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not open that set.";
    // A set that simply is not in the OMR is a 404, not a server fault.
    const status = NOT_IN_OMR.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
