import { useEffect, useRef } from "react";

/** How long a value stepped from the keyboard waits after the last step before it is saved. */
export const STEP_SAVE_DELAY_MS = 500;

/**
 * Saves a value the user is still stepping a short delay after the last step, each step pushing the
 * save back, so a run of arrow presses saves once. `flush` saves a waiting value now (the handle
 * lost focus); one still waiting when the component goes is saved then.
 */
export function useSaveAfterPause<T>(save: (value: T) => void): { schedule(value: T): void; flush(): void } {
  const saveRef = useRef(save);
  saveRef.current = save;
  const waiting = useRef<{ value: T; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = useRef(() => {
    const current = waiting.current;
    if (current === null) return;
    clearTimeout(current.timer);
    waiting.current = null;
    saveRef.current(current.value);
  }).current;
  const schedule = useRef((value: T) => {
    if (waiting.current !== null) clearTimeout(waiting.current.timer);
    waiting.current = { value, timer: setTimeout(flush, STEP_SAVE_DELAY_MS) };
  }).current;
  useEffect(() => flush, [flush]);
  return { schedule, flush };
}
