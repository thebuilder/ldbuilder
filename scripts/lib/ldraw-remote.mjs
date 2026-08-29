const MIRROR =
  "https://cdn.jsdelivr.net/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw";

const ORIGIN = "https://library.ldraw.org/library/official";
const ORIGIN_UNOFFICIAL = "https://library.ldraw.org/library/unofficial";

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

  const attempt = async (url) => {
    try {
      return await fetchImpl(url);
    } catch {
      return null;
    }
  };

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
