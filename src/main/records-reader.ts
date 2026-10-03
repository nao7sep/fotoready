import { Worker } from "node:worker_threads";
import type { RecordsRead, RecordsReadResults } from "@shared/records";
import type { RecordsWorkerData, RecordsWorkerRequest, RecordsWorkerResponse } from "./records-queries";

/** How long one read may take before the window is told it failed (PLAYBOOK, Bound every external wait). */
export const RECORDS_READ_TIMEOUT_MS = 10_000;
/** How long quitting waits for the worker to stop. */
const CLOSE_TIMEOUT_MS = 2_000;

export interface RecordsReader {
  read<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R["op"]]>;
  /** Stops the worker, within a bound; reads after it fail. Never rejects. */
  close(): Promise<void>;
}

type Pending = {
  worker: Worker;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Reads records.sqlite3 for the Records window on one worker thread, started at the first read. A
 * read that does not answer in time fails, and the worker is replaced, since a timeout alone would
 * not stop the query it gave up on; a worker that fails is replaced at the next read.
 */
export function createRecordsReader(
  databasePath: string,
  { timeoutMs = RECORDS_READ_TIMEOUT_MS }: { timeoutMs?: number } = {}
): RecordsReader {
  let worker: Worker | null = null;
  let closed = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  // Fails the reads waiting on `owner`, or on any worker.
  const fail = (error: Error, owner?: Worker): void => {
    for (const [id, read] of pending) {
      if (owner !== undefined && read.worker !== owner) continue;
      pending.delete(id);
      clearTimeout(read.timer);
      read.reject(error);
    }
  };

  const discard = (current: Worker, error: Error): void => {
    if (worker === current) worker = null;
    fail(error, current);
    void current.terminate().catch(() => undefined);
  };

  const ensureWorker = (): Worker => {
    if (worker !== null) return worker;
    // The tests run the source under Node's TypeScript stripping; the app runs electron-vite's
    // workers/records-worker.js entry beside the main bundle.
    const entry = import.meta.url.endsWith(".ts") ? "./workers/records-worker.ts" : "./workers/records-worker.js";
    const created = new Worker(new URL(entry, import.meta.url), { workerData: { databasePath } satisfies RecordsWorkerData });
    created.unref();
    created.on("message", (message: RecordsWorkerResponse) => {
      const read = pending.get(message.id);
      if (!read) return;
      pending.delete(message.id);
      clearTimeout(read.timer);
      if (message.ok) read.resolve(message.value as never);
      else read.reject(new Error(message.error));
    });
    created.on("error", (error: unknown) => discard(created, error instanceof Error ? error : new Error(String(error))));
    created.on("exit", (code) => {
      if (worker === created) discard(created, new Error(`The records worker exited with code ${code}.`));
    });
    worker = created;
    return created;
  };

  return {
    read<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R["op"]]> {
      if (closed) return Promise.reject(new Error("The records reader is closed."));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        let current: Worker;
        try {
          current = ensureWorker();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const timer = setTimeout(
          () => discard(current, new Error(`The records read did not finish within ${timeoutMs} ms.`)),
          timeoutMs
        );
        timer.unref();
        pending.set(id, { worker: current, resolve: resolve as (value: never) => void, reject, timer });
        current.postMessage({ id, read } satisfies RecordsWorkerRequest);
      });
    },
    async close() {
      closed = true;
      const current = worker;
      worker = null;
      fail(new Error("The records reader is closed."));
      if (current === null) return;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
      });
      try {
        await Promise.race([current.terminate().then(() => undefined, () => undefined), timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
