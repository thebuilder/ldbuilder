// Resolve LDraw parts over the network, for hosts with no local parts library.
//
// The library is 36,600 files and 612MB unpacked, 145MB zipped. That is too big
// to commit and too big for a serverless bundle, so a deployment cannot carry
// it. But a model only touches a few hundred parts, so they can be fetched.
//
// Two sources, in order:
//
//   1. A jsDelivr-hosted mirror of the library. This is the fast path: a CDN
//      with no rate limit, measured at ~380 req/s once an edge is warm.
//   2. library.ldraw.org itself, which is authoritative and current but rate
//      limits hard. Measured: ~20 req/s, and 4-way concurrency already returns
//      429 for most requests.
//
// The mirror is a snapshot, so parts added to the library after it was taken are
// only in the second source. Going to the mirror first means the slow, limited
// origin is asked for a handful of recent parts rather than all several hundred,
// which keeps a cold set to a few seconds without hammering anyone.

/**
 * Snapshot of the official library laid out exactly as LDrawLoader expects,
 * published for static hosting by a three.js maintainer.
 */
const MIRROR =
  "https://cdn.jsdelivr.net/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw";

/** The library itself. Current, authoritative, and rate limited. */
const ORIGIN = "https://library.ldraw.org/library/official";
const ORIGIN_UNOFFICIAL = "https://library.ldraw.org/library/unofficial";

/** Directories searched, in the order LDrawLoader itself searches them. */
const SEARCH_DIRS = ["parts", "p", "models"];

/**
 * Where a normalized reference might live under one base.
 *
 * Normalization has already rewritten `s/x.dat` to `parts/s/x.dat` and
 * `48/x.dat` to `p/48/x.dat`, so a name that starts with a search directory is
 * a complete path. Everything else is searched parts/ then p/ then models/,
 * matching the loader's own precedence so the first hit is the file it would
 * have picked. That search is what resolves `8/x.dat`, which the loader
 * deliberately leaves alone even though the file lives under `p/`.
 */
function pathsUnder(base, name) {
  if (SEARCH_DIRS.some((dir) => name.startsWith(`${dir}/`))) {
    return [`${base}/${name}`];
  }
  return SEARCH_DIRS.map((dir) => `${base}/${dir}/${name}`);
}

/**
 * Every URL to try, cheapest first. Unofficial parts come last: OMR sets cite
 * them occasionally, and a slow hit beats a hole in the model.
 */
function candidatePaths(name) {
  return [
    ...pathsUnder(MIRROR, name),
    ...pathsUnder(ORIGIN, name),
    ...pathsUnder(ORIGIN_UNOFFICIAL, name),
  ];
}

/**
 * How many lookups to run at once against this resolver.
 *
 * Sized for the mirror, which is a CDN and does not mind. The origin is only
 * reached for parts the mirror lacks, few enough that this rarely trips its
 * limiter; the retry below covers the times it does. Most of a cold set's time
 * goes on round trips rather than bandwidth, so this is the main lever there.
 */
export const REMOTE_CONCURRENCY = 48;

/** One retry per rate-limited request, after a pause. */
const RETRY_AFTER_MS = 1500;
const TOO_MANY_REQUESTS = 429;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Build a resolver backed by the network.
 *
 * @param {object} [opts]
 * @param {Map<string,string|null>} [opts.cache]  Shared across requests, so a
 *   warm instance packing its second set reuses the first one's parts. Misses
 *   are cached too: a part that exists nowhere would otherwise cost its full
 *   candidate chain every time it is referenced.
 * @param {typeof fetch} [opts.fetchImpl]  Injectable for tests.
 * @returns {(key: string) => Promise<string|null>}
 */
export function networkResolver({ cache = new Map(), fetchImpl = fetch } = {}) {
  const inFlight = new Map();

  /** One request. A network blip is a miss; the caller tries the next candidate. */
  const attempt = async (url) => {
    try {
      return await fetchImpl(url);
    } catch {
      return null;
    }
  };

  /** A missing, failed or errored response all mean the same thing here. */
  const read = async (response) =>
    response?.ok ? await response.text() : null;

  const get = async (url) => {
    const response = await attempt(url);
    if (response?.status !== TOO_MANY_REQUESTS) {
      return await read(response);
    }
    await sleep(RETRY_AFTER_MS);
    return await read(await attempt(url));
  };

  const load = async (key) => {
    for (const url of candidatePaths(key)) {
      // biome-ignore lint/performance/noAwaitInLoops: the candidates are an ordered fallback chain, so a later one is only requested when the earlier one misses
      const text = await get(url);
      if (text !== null) {
        return text;
      }
    }
    return null;
  };

  return (key) => {
    const hit = cache.get(key);
    if (hit !== undefined) {
      return Promise.resolve(hit);
    }

    // Collapse concurrent requests for the same part into one fetch.
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }

    const promise = load(key)
      .then((text) => {
        cache.set(key, text);
        return text;
      })
      .finally(() => inFlight.delete(key));

    inFlight.set(key, promise);
    return promise;
  };
}
