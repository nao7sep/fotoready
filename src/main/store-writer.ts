import { Worker } from "node:worker_threads";
import type { BackupWrite } from "./backup-tables";
import type { RecordRow } from "./records-tables";
import type { StoreWriterData, StoreWriterRequest, StoreWriterResponse, StoreWriterWarning } from "./store-writer-protocol";
import { settleWithin } from "./quit-save";

/**
 * How many records may wait while the writer is busy. A healthy store keeps up with every record the
 * app makes; this bound only matters while the store is locked or stalled, when records beyond it are
 * dropped and their count is recorded once the writer catches up (developer decision).
 */
export const MAX_PENDING_RECORDS = 2_000;

export type StoreWriterOptions = StoreWriterData & {
  /** The record that reports how many records were dropped while the writer was busy. */
  droppedRecord(count: number): RecordRow;
  /** Logs a failure the writer reported, such as a backup that could not be recorded. */
  onWarning(warning: StoreWriterWarning): void;
  maxPendingRecords?: number;
};

export interface StoreWriter {
  /** Queues a record; never waits and never throws. */
  writeRecord(row: RecordRow): void;
  /** Queues a backup; a newer pending write of the same path replaces an older one. Never waits or throws. */
  writeBackup(write: BackupWrite): void;
  /** Called after each batch the database stored records from; the Records window follows it. */
  onStored(listener: () => void): void;
  /**
   * Stops the writer. With `drain`, the pending writes get up to `timeoutMs` (ordinary quit) and it
   * resolves whether they finished in time; without it they are skipped (OS session end) and it
   * resolves whether the writer was idle, so nothing it was writing can hold the exit. Never rejects.
   */
  close(options: { drain: boolean; timeoutMs: number }): Promise<boolean>;
}

/** Starts the one writer of records.sqlite3 and backups.sqlite3 on its own worker thread. */
export function startStoreWriter(options: StoreWriterOptions): StoreWriter {
  const { droppedRecord, onWarning, maxPendingRecords = MAX_PENDING_RECORDS, ...data } = options;
  // The tests run the source under Node's TypeScript stripping; the app runs electron-vite's
  // workers/store-writer.js entry beside the main bundle.
  const entry = import.meta.url.endsWith(".ts") ? "./workers/store-writer.ts" : "./workers/store-writer.js";
  const worker = new Worker(new URL(entry, import.meta.url), { workerData: data satisfies StoreWriterData });
  worker.unref();

  let pendingRecords: RecordRow[] = [];
  let pendingBackups = new Map<string, BackupWrite>();
  let dropped = 0;
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
    pendingBackups = new Map();
    inFlight = false;
    for (const resolve of idleWaiters.splice(0)) resolve();
    closedWaiter?.();
    void worker.terminate().catch(() => undefined);
  };

  const send = (): void => {
    if (stopped || inFlight) return;
    if (dropped > 0) {
      pendingRecords.unshift(droppedRecord(dropped));
      dropped = 0;
    }
    if (pendingRecords.length === 0 && pendingBackups.size === 0) {
      for (const resolve of idleWaiters.splice(0)) resolve();
      return;
    }
    const request: StoreWriterRequest = { kind: "batch", id: nextId++, records: pendingRecords, backups: [...pendingBackups.values()] };
    pendingRecords = [];
    pendingBackups = new Map();
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
    if (stopped || (!inFlight && pendingRecords.length === 0 && pendingBackups.size === 0 && dropped === 0)) resolve();
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
      if (pendingRecords.length >= maxPendingRecords) {
        dropped += 1;
        return;
      }
      pendingRecords.push(row);
      send();
    },
    writeBackup(write) {
      if (stopped) return;
      pendingBackups.delete(write.path);
      pendingBackups.set(write.path, write);
      send();
    },
    onStored(listener) {
      storedListener = listener;
    },
    async close({ drain, timeoutMs }) {
      if (stopped) return true;
      if (!drain) {
        const idle = !inFlight;
        stop(null);
        return idle;
      }
      const drained = (async () => {
        await whenIdle();
        if (stopped) return;
        const closed = new Promise<void>((resolve) => { closedWaiter = resolve; });
        worker.postMessage({ kind: "close" } satisfies StoreWriterRequest);
        await closed;
      })();
      const finished = await settleWithin(drained, timeoutMs);
      stop(null);
      return finished;
    }
  };
}
