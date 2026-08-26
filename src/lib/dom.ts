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
