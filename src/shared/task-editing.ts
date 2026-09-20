import type { TaskStatus } from "./types/project";

/**
 * Whether a task's pipeline may still be changed. Only a `not-saved` task may: once
 * it is queued, processing or saved, its ops and output describe work the app has
 * already committed to, and forking is the way back to editing.
 *
 * It lives in shared because the main process and the renderer must lock the same
 * set: the controls the renderer disables are exactly the edits the session refuses.
 * The canvas had no copy of the rule at all and drew draggable overlay handles over
 * a saved task, so a crop or watermark moved under the pointer and the edit failed
 * behind it.
 */
export function isTaskEditable(status: TaskStatus): boolean {
  return status === "not-saved";
}
