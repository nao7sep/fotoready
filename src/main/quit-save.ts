import type { Logger } from "@shared/types/log";

/**
 * The user's own work that a write can fail to save: the settings and API key they save, and the
 * task sidecar written beside a saved image when they change its details. Everything else the app
 * writes — UI state, window placement, records, backups, caches — never holds a quit.
 */
export type UserWork = { kind: "settings" } | { kind: "sidecar"; file: string };

export type QuitChoice = "cancel" | "retry" | "quit";

/**
 * A write of the user's own work that its owner has not saved: still running, or failed and not
 * written again since. Each owner — the settings chain, the key store and the output-files lane —
 * reports its latest such write, so a save that failed earlier in the session is asked about at
 * quit too. `retry` runs that write again.
 */
export type UnsavedWrite = { work: UserWork; running: boolean; settled: Promise<unknown>; retry(): void };

/** What the quit's checks use of the one exit deadline (installQuitShutdown in bootstrap). */
export type QuitDeadline = {
  /** Asks the user a quit question: the deadline pauses meanwhile and starts again when the answer arrives. */
  ask<T>(question: () => Promise<T>): Promise<T>;
  /** Resolves true when `work` settles, false when what remains of the deadline runs out first. Never rejects. */
  within(work: Promise<unknown>): Promise<boolean>;
};

/** The unsaved writes as a log line carries them. */
export function describeUnsaved(writes: UnsavedWrite[]): { failed: UserWork[]; running: UserWork[] } {
  return {
    failed: writes.filter((write) => !write.running).map((write) => write.work),
    running: writes.filter((write) => write.running).map((write) => write.work)
  };
}

/**
 * The quit's save of the user's own work: waits for the running writes within what remains of the
 * exit deadline, and when some of it is not saved on a quit the user started, asks whether to cancel
 * the quit, retry, or quit anyway. An ending session never asks. Resolves false when the user cancels
 * the quit.
 */
export async function saveUserWorkBeforeQuit(
  unsaved: () => UnsavedWrite[],
  deadline: QuitDeadline,
  ask: (unsaved: UserWork[]) => Promise<QuitChoice>,
  sessionEnding: () => boolean,
  logger: Pick<Logger, "info" | "error">
): Promise<boolean> {
  for (;;) {
    // A write that lands can be followed by one the user started meanwhile, which is waited for too.
    let running = unsaved().filter((write) => write.running);
    while (running.length > 0 && await deadline.within(Promise.allSettled(running.map((write) => write.settled)))) {
      running = unsaved().filter((write) => write.running);
    }
    const writes = unsaved();
    if (writes.length === 0) return true;
    logger.error("the user's work was not saved before quit", { mod: "main.quit", ...describeUnsaved(writes) });
    if (sessionEnding()) return true;
    const choice = await deadline.ask(() => ask(uniqueWork(writes.map((write) => write.work))));
    if (sessionEnding()) return true;
    logger.info("quit question answered", { mod: "main.quit", choice });
    if (choice === "quit") return true;
    if (choice === "cancel") return false;
    for (const write of writes) if (!write.running) write.retry();
  }
}

function uniqueWork(work: UserWork[]): UserWork[] {
  const seen = new Set<string>();
  return work.filter((item) => {
    const key = item.kind === "sidecar" ? `sidecar:${item.file}` : item.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
