import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const workers = vi.hoisted(() => [] as Array<{ emit(event: string, value: unknown): boolean; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }>);
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    unref() {}
    terminate = vi.fn(async () => 0);
    constructor() { super(); workers.push(this); }
  }
}));
import { createRecordsReader } from "@main/records-reader";
afterEach(() => { workers.length = 0; });

it("fails waiting reads when the worker fails, starts a new worker at the next read and stops it on close", async () => {
  const reader = createRecordsReader("unused.sqlite3");
  const waiting = reader.read({ op: "sources" });
  const failed = workers[0]!;
  failed.emit("error", new Error("worker crashed"));
  await expect(waiting).rejects.toThrow("worker crashed");

  const next = reader.read({ op: "sources" });
  expect(workers).toHaveLength(2);
  const replacement = workers[1]!;
  const request = replacement.postMessage.mock.calls[0]![0] as { id: number };
  replacement.emit("message", { id: request.id, ok: true, value: { sessions: [], taskIds: [] } });
  await expect(next).resolves.toEqual({ sessions: [], taskIds: [] });

  await reader.close();
  expect(replacement.terminate).toHaveBeenCalledOnce();
});
