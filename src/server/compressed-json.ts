// Packed models are large: a 5,000-brick set is close to 4MB of JSON, because
// every part's geometry is inlined into the .mpd by design. That text is highly
// repetitive and compresses about 6.4:1, but nothing compresses it by default,
// so the route does it.
//
// This also keeps the response clear of the 4.5MB body limit a serverless
// function has, which an uncompressed 9,000-brick set would otherwise approach.

import { gzip } from "node:zlib";
import { NextResponse } from "next/server";

const gzipAsync = (data: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    gzip(data, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });

/** Below this, framing overhead outweighs anything compression saves. */
const MIN_COMPRESS_BYTES = 4096;

/**
 * JSON response, gzipped when the caller accepts it.
 *
 * `fetch` decompresses transparently, so callers see plain JSON either way.
 */
export async function compressedJson(
  request: Request,
  body: unknown,
  init: { headers?: Record<string, string> } = {}
): Promise<Response> {
  const text = JSON.stringify(body);
  const headers = { ...init.headers, "content-type": "application/json" };

  const accepts = request.headers.get("accept-encoding") ?? "";
  if (text.length < MIN_COMPRESS_BYTES || !accepts.includes("gzip")) {
    return new NextResponse(text, { headers });
  }

  const packed = await gzipAsync(text);
  return new NextResponse(packed as unknown as BodyInit, {
    headers: {
      ...headers,
      "content-encoding": "gzip",
      // The body varies by encoding, so a shared cache must key on it.
      vary: "Accept-Encoding",
    },
  });
}
