/**
 * The Popover API is Baseline newly available rather than widely available, so
 * browsers that predate it get a polyfill. Feature-detected and imported on
 * demand: loading it unconditionally would ship dead code to everyone else.
 */
export function ensurePopoverSupport(): void {
  if (typeof HTMLElement === "undefined") {
    return;
  }
  if ("popover" in HTMLElement.prototype) {
    return;
  }
  import("@oddbird/popover-polyfill").catch((error) => {
    // Without it the shortcuts sheet simply will not open on an old browser,
    // which is a degraded experience rather than a broken page.
    console.warn("[ldraw] popover polyfill failed to load", error);
  });
}

/**
 * Whether anything is currently open in the top layer.
 *
 * Escape belongs to the topmost layer first. Without this check, dismissing the
 * shortcuts sheet would also clear the selected brick underneath it.
 */
export function isAnyPopoverOpen(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  try {
    if (document.querySelector("[popover]:popover-open")) {
      return true;
    }
  } catch {
    // Older browser with no :popover-open pseudo-class. The polyfill mirrors
    // the state as a class, which the next check picks up.
  }
  return document.querySelector("[popover].\\:popover-open") !== null;
}
