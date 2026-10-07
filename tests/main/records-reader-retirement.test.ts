import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const workers = vi.hoisted(() => [] as Array<{ emit(event: string, value: unknown): boolean; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; finish(): void }>);
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    unref() {}
    finish!: () => void;
    terminate = vi.fn(() => new Promise<number>((resolve) => { this.finish = () => resolve(0); }));
    constructor() { super(); workers.push(this); }
  }
}));
import { createRecordsReader } from "@main/records-reader";
afterEach(() => { workers.length = 0; vi.useRealTimers(); });

it("times out an admitted read on a warm worker and joins its retirement before close finishes", async () => {
  vi.useFakeTimers();
  const reader = createRecordsReader("unused.sqlite3", { timeoutMs: 100 });
  const warm = reader.read({ op: "sources" });
  const owner = workers[0]!;
  const initial = owner.postMessage.mock.calls[0]![0] as { id: number };
  owner.emit("message", { id: initial.id, ok: true, value: { sessions: [], taskIds: [] } });
  await warm;
  const blocked = reader.read({ op: "sources" });
  expect(owner.postMessage).toHaveBeenCalledTimes(2);
  const failure = expect(blocked).rejects.toThrow("did not finish within 100 ms");
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(owner.terminate).toHaveBeenCalledTimes(1);
  let closed = false;
  const closing = reader.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  owner.finish();
  await closing;
  expect(closed).toBe(true);
  expect(owner.terminate).toHaveBeenCalledTimes(1);
});
