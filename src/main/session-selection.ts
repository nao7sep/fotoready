/**
 * Pure selection-recovery logic for the project session: given the originals and
 * tasks that REMAIN after an original was removed, decide which task should become
 * active. Kept here (not in the session class) so it stays free of Electron/IO
 * dependencies and is unit-testable on its own.
 *
 * Picking the removed original's positional neighbour (the original that slid into
 * its slot, else the one before it) keeps the selection — and therefore the
 * Originals list's keyboard focus, which follows the selection — next to where the
 * deletion happened, instead of jumping to the first task. Falls back to the first
 * remaining task when the neighbour has no task (its slot was reused away), and to
 * null when nothing remains.
 */
export function pickActiveTaskAfterOriginalRemoval(
  remainingOriginals: readonly { id: string }[],
  removedIndex: number,
  remainingTasks: readonly { id: string; originalId: string }[],
): string | null {
  const neighbour = remainingOriginals[removedIndex] ?? remainingOriginals[removedIndex - 1] ?? null;
  const neighbourTask = neighbour ? remainingTasks.find((task) => task.originalId === neighbour.id) : null;
  return neighbourTask?.id ?? remainingTasks[0]?.id ?? null;
}
