/**
 * The bits of talking to `localStorage` that every saved thing needs.
 *
 * Reading is defensive because the store can be disabled, cleared, or holding
 * something an older version of the app wrote. Writing can fail outright when
 * it is full, and a save is never important enough to throw over: the caller
 * gets a false and decides what to drop.
 */

export function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access itself throws when cookies are blocked entirely.
    return null;
  }
}

/** Parse a stored value, or null if it is absent, corrupt or the wrong shape. */
export function readJson<T>(
  key: string,
  valid: (value: unknown) => value is T
): T | null {
  const store = storage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** False when the write did not happen, which usually means the store is full. */
export function writeRaw(key: string, json: string): boolean {
  const store = storage();
  if (!store) {
    return false;
  }
  try {
    store.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do: the entry simply stays.
  }
}

/** Trim floating-point noise from a value nobody will measure to the micron. */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
