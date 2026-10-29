import { Worker } from "node:worker_threads";
import type { RecordsRead, RecordsReadResults } from "@shared/records";
import type { BackupWrite } from "./backup-tables";
import type { RecordRow } from "./records-tables";
import type { StoreWriterData, StoreWriterRequest, StoreWriterResponse, StoreWriterWarning } from "./store-writer-protocol";

export type StoreWriterOptions = StoreWriterData & {
  /** Logs a failure the writer reported, such as a backup that could not be recorded. */
  onWarning(warning: StoreWriterWarning): void;
};

export interface StoreWriter {
  /**
   * Queues a record; never waits and never throws. Records wait without a cap while the store is
   * locked or stalled, until it recovers or the exit deadline ends the session.
   */
  writeRecord(row: RecordRow): void;
  /** Queues a backup, applied in save order. Never waits or throws. */
  writeBackup(write: BackupWrite): void;
  /**
   * Reads records.sqlite3 for the Records window, answered in turn with the writes. Fails once the
   * writer is closing or has stopped.
   */
  read<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R["op"]]>;
  /** Called after each batch the database stored records from; the Records window follows it. */
  onStored(listener: () => void): void;
  /**
   * Stops the writer. With `drain` (ordinary quit), the pending writes are written first, within what
   * remains of the exit deadline, and it resolves true; without it they are skipped (OS session end)
   * and it resolves whether the writer was idle, so nothing it was writing can hold the exit. Never rejects.
   */
  close(options: { drain: boolean }): Promise<boolean>;
}

/** Starts the one owner of records.sqlite3 and backups.sqlite3 on its own worker thread. */
export function startStoreWriter(options: StoreWriterOptions): StoreWriter {
  const { onWarning, ...data } = options;
  // The tests run the source under Node's TypeScript stripping; the app runs electron-vite's
  // workers/store-writer.js entry beside the main bundle.
  const entry = import.meta.url.endsWith(".ts") ? "./workers/store-writer.ts" : "./workers/store-writer.js";
  const worker = new Worker(new URL(entry, import.meta.url), { workerData: data satisfies StoreWriterData });
  worker.unref();

  let pendingRecords: RecordRow[] = [];
  let pendingBackups: BackupWrite[] = [];
  const pendingReads = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  let closing = false;
  // Set once the close message is sent: the worker closes its stores then, and nothing after it may reopen them.
  let closeSent = false;
  let inFlight = false;
  let nextId = 1;
  let stopped = false;
  let storedListener: (() => void) | null = null;
  let idleWaiters: Array<() => void> = [];
  let closedWaiter: (() => void) | null = null;

  /** Once the writer is gone, a record goes to the console so a warning or error is not lost silently. */
  const toConsole = (row: RecordRow): void => {
    (row.level === "error" || row.level === "warn" ? console.error : console.log)(row.fallback);
  };

  const stop = (reason: unknown): void => {
    if (stopped) return;
    stopped = true;
    if (reason !== null) console.error("[store-writer] the store writer stopped; writing records to the console", reason);
    for (const row of pendingRecords) toConsole(row);
    pendingRecords = [];
    pendingBackups = [];
    inFlight = false;
    for (const read of pendingReads.values()) read.reject(new Error("The store writer stopped."));
    pendingReads.clear();
    for (const resolve of idleWaiters.splice(0)) resolve();
    closedWaiter?.();
    void worker.terminate().catch(() => undefined);
  };

  const send = (): void => {
    if (stopped || inFlight || closeSent) return;
    if (pendingRecords.length === 0 && pendingBackups.length === 0) {
      for (const resolve of idleWaiters.splice(0)) resolve();
      return;
    }
    const request: StoreWriterRequest = { kind: "batch", id: nextId++, records: pendingRecords, backups: pendingBackups };
    pendingRecords = [];
    pendingBackups = [];
    inFlight = true;
    try {
      worker.postMessage(request);
    } catch (error) {
      stop(error);
    }
  };

  worker.on("message", (message: StoreWriterResponse) => {
    if (message.kind === "closed") {
      closedWaiter?.();
      return;
    }
    if (message.kind === "read") {
      const read = pendingReads.get(message.id);
      if (!read) return;
      pendingReads.delete(message.id);
      if (message.ok) read.resolve(message.value as never);
      else read.reject(new Error(message.error));
      return;
    }
    inFlight = false;
    for (const warning of message.warnings) {
      try { onWarning(warning); } catch (error) { console.error("[store-writer] a writer warning could not be logged", error); }
    }
    if (message.stored > 0) {
      // A listener that throws did not fail the write.
      try { storedListener?.(); } catch (error) { console.error("[records] the stored-record listener failed", error); }
    }
    send();
  });
  worker.on("error", (error) => stop(error));
  worker.on("exit", (code) => stop(closedWaiter === null ? new Error(`The store writer exited with code ${code}.`) : null));

  const whenIdle = (): Promise<void> => new Promise((resolve) => {
    if (stopped || (!inFlight && pendingRecords.length === 0 && pendingBackups.length === 0)) resolve();
    else {
      idleWaiters.push(resolve);
      send();
    }
  });

  return {
    writeRecord(row) {
      if (stopped) {
        toConsole(row);
        return;
      }
      pendingRecords.push(row);
      send();
    },
    writeBackup(write) {
      if (stopped) return;
      pendingBackups.push(write);
      send();
    },
    read<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R["op"]]> {
      if (stopped || closing) return Promise.reject(new Error("The store writer is closed."));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pendingReads.set(id, { resolve: resolve as (value: never) => void, reject });
        try {
          worker.postMessage({ kind: "read", id, read } satisfies StoreWriterRequest);
        } catch (error) {
          stop(error);
        }
      });
    },
    onStored(listener) {
      storedListener = listener;
    },
    async close({ drain }) {
      if (stopped) return true;
      closing = true;
      if (!drain) {
        const idle = !inFlight;
        stop(null);
        return idle;
      }
      await whenIdle();
      if (!stopped) {
        const closed = new Promise<void>((resolve) => { closedWaiter = resolve; });
        closeSent = true;
        worker.postMessage({ kind: "close" } satisfies StoreWriterRequest);
        await closed;
      }
      stop(null);
      return true;
    }
  };
}
