/**
 * The two things every loader in here needs: a way to see where the time went,
 * and a way to let the page repaint before spending it.
 */

interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

/**
 * Hand control back to the event loop so the progress UI can update between
 * phases. The parse itself is one synchronous block and cannot be split.
 *
 * Not requestAnimationFrame. Browsers throttle rAF to a crawl, or stop it, when
 * the tab is hidden or otherwise not painting, which turned a 250ms load into an
 * eight second one. `scheduler.yield` and `setTimeout` run either way.
 */
export function yieldToBrowser(): Promise<void> {
  const { scheduler } = globalThis as { scheduler?: SchedulerWithYield };
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Phase timings. Loading is the slowest thing the app does, and without these it
 * is guesswork which phase is responsible.
 */
export function stopwatch() {
  const marks: [string, number][] = [];
  let last = performance.now();
  return {
    log(label: string) {
      if (process.env.NODE_ENV === "production") {
        return;
      }
      const total = marks.reduce((sum, [, ms]) => sum + ms, 0);
      console.info(
        `[ldraw] ${label} loaded in ${total.toFixed(0)}ms:`,
        marks.map(([name, ms]) => `${name} ${ms.toFixed(0)}ms`).join(", ")
      );
    },
    mark(name: string) {
      const now = performance.now();
      marks.push([name, now - last]);
      last = now;
    },
  };
}
