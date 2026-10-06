import type { Logger } from "@shared/types/log";

/**
 * The user's own work that a write can fail to save: the settings and API key they save, and the
 * task sidecar written beside a saved image when they change its details. Everything else the app
 * writes — UI state, window placement, records, backups, caches — never holds a quit.
 */
export type UserWork = { kind: "settings" } | { kind: "sidecar"; file: string };

export type QuitChoice = "cancel" | "retry" | "quit";

/** The bound on waiting for the user's own work at quit (unsaved-edits-conventions, Quitting). */
export const QUIT_SAVE_MS = 2_000;

type Write = { work: UserWork; write: () => Promise<unknown> };

/**
 * The writes of the user's own work. Each is written when the user acts, so quitting has nothing
 * buffered to flush: it waits for the writes still running, and a write that fails while a quit is
 * under way is kept so the quit can retry it. A failure before the quit began was already shown
 * where it happened, so it is not kept.
 */
export class UserWorkWrites {
  #running = new Map<Promise<unknown>, UserWork>();
  #failed: Write[] = [];
  #quitting = false;

  run<T>(work: UserWork, write: () => Promise<T>): Promise<T> {
    const running = write();
    this.#running.set(running, work);
    running.then(
      () => this.#running.delete(running),
      () => {
        this.#running.delete(running);
        if (this.#quitting) this.#failed.push({ work, write });
      }
    );
    return running;
  }

  beginQuit(): void {
    this.#quitting = true;
  }

  /** A quit that was cancelled: its kept failures were shown where they happened. */
  endQuit(): void {
    this.#quitting = false;
    this.#failed = [];
  }

  /** Runs every kept failure again. */
  retry(): void {
    const failed = this.#failed;
    this.#failed = [];
    for (const { work, write } of failed) void this.run(work, write).catch(() => undefined);
  }

  /** What is not saved now: the writes that failed during the quit and those still running. */
  unsaved(): { failed: UserWork[]; running: UserWork[] } {
    return { failed: this.#failed.map((entry) => entry.work), running: [...this.#running.values()] };
  }

  /** Waits up to `ms` for the running writes, including any they start, then reports what is not saved. */
  async settle(ms: number): Promise<{ failed: UserWork[]; running: UserWork[] }> {
    const idle = async (): Promise<void> => {
      while (this.#running.size > 0) await Promise.allSettled([...this.#running.keys()]);
    };
    await settleWithin(idle(), ms);
    return this.unsaved();
  }
}

/**
 * The quit's save of the user's own work: waits for it within QUIT_SAVE_MS, and when some of it is
 * not saved on a quit the user started, asks whether to cancel the quit, retry, or quit anyway. An
 * ending session never asks. Resolves false when the user cancels the quit.
 */
export async function saveUserWorkBeforeQuit(
  writes: UserWorkWrites,
  ask: (unsaved: UserWork[]) => Promise<QuitChoice>,
  sessionEnding: () => boolean,
  logger: Pick<Logger, "info" | "error">
): Promise<boolean> {
  for (;;) {
    const { failed, running } = await writes.settle(QUIT_SAVE_MS);
    if (failed.length === 0 && running.length === 0) return true;
    logger.error("the user's work was not saved before quit", { mod: "main.quit", failed, running, waitMs: QUIT_SAVE_MS });
    if (sessionEnding()) return true;
    const choice = await ask(uniqueWork([...failed, ...running]));
    if (sessionEnding()) return true;
    logger.info("quit question answered", { mod: "main.quit", choice });
    if (choice === "quit") return true;
    if (choice === "cancel") return false;
    writes.retry();
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

/** Resolves true when `work` settles within `ms`, false when the wait runs out first. Never rejects. */
export async function settleWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([work.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
