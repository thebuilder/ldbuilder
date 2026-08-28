const FORM_ELEMENT = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * Whether a key event is aimed at a control that owns its own keys.
 *
 * Both the camera navigation and the build shortcuts bind to the window, so
 * they have to stand aside when a slider or a text field has focus. A focused
 * range input uses the arrows to change its value.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return element !== null && FORM_ELEMENT.test(element.tagName);
}

/**
 * Whether the viewer has asked for as little movement as possible.
 *
 * Read at the moment it matters rather than subscribed to, since every caller
 * is already deciding something frame by frame, and the setting changes about
 * as often as a person changes their mind about it.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
