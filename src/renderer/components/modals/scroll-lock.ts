/**
 * Reference-counted background scroll lock for {@link ./modal-shell.ModalShell}.
 *
 * Every open modal layer holds one reference; the body is locked while the count is positive and
 * unlocked only when the last layer releases. Counting (rather than a boolean) is what makes this
 * correct under stacking and out-of-order unmount: a confirm dialog opened over a settings modal
 * must not unlock the body when *it* closes while the settings modal is still open.
 *
 * Like {@link ./focus-trap}, the module splits the pure decision from the DOM binding:
 *  - {@link acquireScrollLock} / {@link releaseScrollLock} own the integer count and report the
 *    0↔1 *transition* — the only edge at which the body state actually changes — and can be unit
 *    tested without a DOM. The count clamps at 0 so an extra or unbalanced release never goes
 *    negative.
 *  - {@link applyBodyScrollLock} is the thin binding that toggles `body.modal-open` on that edge.
 *
 * Note: fotoready's body is already globally `overflow: hidden` (a fixed-viewport Electron shell),
 * so the visible effect of this lock is minimal — the page behind a modal cannot scroll regardless.
 * The point is that the shell *owns* the modal-dialog scroll-lock contract explicitly rather than
 * leaning on an incidental global rule. For the same reason there is deliberately no scroll-position
 * save/restore or `position: fixed` body-shifting here: that machinery exists to fight reflow in a
 * normally-scrolling document, and would be dead complexity in a viewport that never scrolls.
 */

let lockCount = 0;

/**
 * Add one reference. Returns `true` only on the 0→1 edge, i.e. when this is the call that actually
 * locks the body; subsequent nested acquires return `false`.
 */
export function acquireScrollLock(): boolean {
  lockCount += 1;
  const lockedNow = lockCount === 1;
  if (lockedNow) applyBodyScrollLock(true);
  return lockedNow;
}

/**
 * Remove one reference. Returns `true` only on the 1→0 edge, i.e. when the last reference is
 * released and the body is unlocked. Clamps at 0, so an extra or unbalanced release is a no-op and
 * the count never goes negative.
 */
export function releaseScrollLock(): boolean {
  if (lockCount === 0) return false;
  lockCount -= 1;
  const unlockedNow = lockCount === 0;
  if (unlockedNow) applyBodyScrollLock(false);
  return unlockedNow;
}

/** Toggle the `body.modal-open` class that locks background scrolling. Call only on the 0↔1 edge. */
export function applyBodyScrollLock(locked: boolean): void {
  document.body.classList.toggle("modal-open", locked);
}
