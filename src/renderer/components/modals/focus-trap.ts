/**
 * Tab focus trapping for {@link ./modal-shell.ModalShell}.
 *
 * The pure decision — given the focusable count, where focus currently sits, and the Shift state,
 * which edge (if any) to wrap to — lives in {@link tabTrapTarget} so it can be unit tested without a
 * DOM. {@link trapTabFocus} is the thin binding that reads the live DOM and applies the decision.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

/**
 * Which edge of the focusable list Tab should wrap to, or `null` to let the browser move focus
 * normally.
 *
 * `activeIndex` is the index of the focused element within the focusable list, or `< 0` when focus
 * is on the modal surface itself or anywhere outside the list. That out-of-list case is the one a
 * naive trap misses: focus must be pulled to the near edge (Tab → first, Shift+Tab → last) instead
 * of being allowed to escape.
 */
export function tabTrapTarget(params: { count: number; activeIndex: number; shiftKey: boolean }): "first" | "last" | null {
  const { count, activeIndex, shiftKey } = params;
  if (count === 0) return null;
  if (activeIndex < 0) return shiftKey ? "last" : "first";
  if (shiftKey && activeIndex === 0) return "last";
  if (!shiftKey && activeIndex === count - 1) return "first";
  return null;
}

/** Keep Tab/Shift+Tab cycling inside `modal`; pull focus to an edge if it sits on the surface or escapes. */
export function trapTabFocus(event: KeyboardEvent, modal: HTMLElement | null): void {
  if (!modal) return;
  const focusable = focusableWithin(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }
  const active = document.activeElement;
  const activeIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
  const target = tabTrapTarget({ count: focusable.length, activeIndex, shiftKey: event.shiftKey });
  if (!target) return;
  event.preventDefault();
  (target === "first" ? focusable[0] : focusable[focusable.length - 1]).focus();
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  // Any negative tabIndex removes an element from sequential tab order, so only `>= 0` participates.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && isVisible(element));
}

function isVisible(element: HTMLElement): boolean {
  return element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0;
}
