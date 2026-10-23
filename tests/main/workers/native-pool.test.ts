import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeJobRetiringError, NativeProcessPool } from "@main/workers/native-pool";

const execFileAsync = promisify(execFile);
const filename = fileURLToPath(new URL("../../fixtures/native-pool-worker.mjs", import.meta.url));
const memory = 1024 * 1024 * 1024;
type Echo = { pid: number; value: string };
type Ready = { pid: number; descendantPid: number | null };
let directory: string;
let pools: NativeProcessPool[];

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-native-pool-"));
  pools = [];
});

afterEach(async () => {
  await Promise.all(pools.map((pool) => pool.destroy()));
  await fs.rm(directory, { recursive: true, force: true });
});

function createPool(cores = 2): NativeProcessPool {
  const pool = new NativeProcessPool(filename, cores, memory);
  pools.push(pool);
  return pool;
}

function echo(pool: NativeProcessPool, value: string, lane: "interactive" | "background" = "background"): Promise<Echo> {
  return pool.run<Echo>(() => ({ kind: "echo", value }), { lane, cost: 1, deadlineMs: 2000 });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function holdRequest(name: string, spawnDescendant = false): Promise<{ kind: "hold"; readyPath: string; fifoPath?: string; spawnDescendant: boolean }> {
  const readyPath = path.join(directory, `${name}.json`);
  if (process.platform === "win32") return { kind: "hold", readyPath, spawnDescendant };
  const fifoPath = path.join(directory, `${name}.fifo`);
  await execFileAsync("mkfifo", [fifoPath]);
  return { kind: "hold", readyPath, fifoPath, spawnDescendant };
}

async function ready(readyPath: string): Promise<Ready> {
  let result: Ready | undefined;
  await vi.waitFor(async () => {
    result = JSON.parse(await fs.readFile(readyPath, "utf8")) as Ready;
  }, { timeout: 2000, interval: 10 });
  return result!;
}

describe("NativeProcessPool physical ownership", () => {
  it("reuses the largest measured idle helper after other idle memory physically exits", async () => {
    const pool = createPool(3);
    const mib = 1024 * 1024;
    // Start both before either replies, with the smaller helper created first. Only reported RSS
    // differs; neither child allocates these buffers. Their combined idle charge exceeds 45%.
    const [small, large] = await Promise.all([
      pool.run<Echo>(() => ({ kind: "echo", value: "small", residentBytes: 200 * mib }), { lane: "interactive", cost: 1, deadlineMs: 2000 }),
      pool.run<Echo>(() => ({ kind: "echo", value: "large", residentBytes: 300 * mib }), { lane: "background", cost: 1, deadlineMs: 2000 })
    ]);
    expect(small.pid).not.toBe(large.pid);
    let smallExistsAtAdmission: boolean | undefined;
    const make = vi.fn(() => {
      smallExistsAtAdmission = processExists(small.pid);
      return { kind: "echo", value: "reused largest", residentBytes: 300 * mib };
    });
    const work = pool.run<Echo>(make, { lane: "background", cost: 250 * mib, deadlineMs: 2000 });
    expect(make).not.toHaveBeenCalled();
    const completed = await work;
    expect(make).toHaveBeenCalledOnce();
    expect(smallExistsAtAdmission).toBe(false);
    expect(completed.pid).toBe(large.pid);
    expect(completed.value).toBe("reused largest");
    expect(processExists(large.pid)).toBe(true);
  });

  it("keeps idle resident memory charged while a background job is held and waits for its physical retirement", async () => {
    const pool = createPool(3);
    const mib = 1024 * 1024;
    const large = await pool.run<Echo>(() => ({ kind: "echo", value: "large", residentBytes: 300 * mib }), { lane: "background", cost: 1, deadlineMs: 2000 });
    const request = await holdRequest("resident-held");
    const controller = new AbortController();
    const blocked = pool.run(() => request, { lane: "background", cost: 1, deadlineMs: 60_000, signal: controller.signal }).catch((error: unknown) => error);
    expect(await ready(request.readyPath)).toMatchObject({ pid: large.pid });
    const idle = await pool.run<Echo>(() => ({ kind: "echo", value: "idle", residentBytes: 200 * mib }), { lane: "interactive", cost: 1, deadlineMs: 2000 });
    expect(idle.pid).not.toBe(large.pid);
    let heldExistsAtAdmission: boolean | undefined;
    const make = vi.fn(() => {
      heldExistsAtAdmission = processExists(large.pid);
      return { kind: "echo", value: "after resident release", residentBytes: 200 * mib };
    });
    // The next job's 100 MiB fits by itself; the active 300 MiB and idle 200 MiB together do not.
    const next = pool.run<Echo>(make, { lane: "background", cost: 100 * mib, deadlineMs: 2000 });
    expect(make).not.toHaveBeenCalled();
    controller.abort();
    expect(await blocked).toBeInstanceOf(NativeJobRetiringError);
    const completed = await next;
    expect(make).toHaveBeenCalledOnce();
    expect(heldExistsAtAdmission).toBe(false);
    expect(completed.pid).toBe(idle.pid);
  });

  it("serves interactive work while a background helper is blocked in native I/O", async () => {
    const pool = createPool();
    const initial = await echo(pool, "background ready");
    const request = await holdRequest("background");
    let settled = false;
    const blocked = pool.run(() => request, { lane: "background", cost: 1, deadlineMs: 60_000 })
      .catch((error: unknown) => error).finally(() => { settled = true; });
    expect(await ready(request.readyPath)).toMatchObject({ pid: initial.pid });

    const interactive = await echo(pool, "interactive completed", "interactive");

    expect(interactive.value).toBe("interactive completed");
    expect(interactive.pid).not.toBe(initial.pid);
    expect(processExists(initial.pid)).toBe(true);
    expect(settled).toBe(false);
    await pool.destroy();
    expect(await blocked).toBeInstanceOf(NativeJobRetiringError);
    expect(processExists(initial.pid)).toBe(false);
    expect(processExists(interactive.pid)).toBe(false);
  });

  it("returns a retiring timeout and admits the next background job only after physical exit", async () => {
    const pool = createPool();
    const initial = await echo(pool, "ready before timed read");
    const request = await holdRequest("timed");
    const blocked = pool.run(() => request, { lane: "background", cost: 1, deadlineMs: 2000 }).catch((error: unknown) => error);
    await ready(request.readyPath);
    let previousExistsAtAdmission: boolean | undefined;
    const make = vi.fn(() => {
      previousExistsAtAdmission = processExists(initial.pid);
      return { kind: "echo", value: "after native exit" };
    });
    const next = pool.run<Echo>(make, { lane: "background", cost: 1, deadlineMs: 2000 });
    expect(make).not.toHaveBeenCalled();

    const timedOut = await blocked;
    expect(timedOut).toBeInstanceOf(NativeJobRetiringError);
    expect(timedOut).toMatchObject({ code: "ETIMEDOUT" });
    const completed = await next;
    expect(make).toHaveBeenCalledOnce();
    expect(previousExistsAtAdmission).toBe(false);
    expect(completed).toMatchObject({ value: "after native exit" });
    expect(completed.pid).not.toBe(initial.pid);
  });

  it("keeps queued make calls lazy and never allocates a cancelled queued bitmap", async () => {
    const pool = createPool();
    const initial = await echo(pool, "ready before queue");
    const request = await holdRequest("queued");
    const blocked = pool.run(() => request, { lane: "background", cost: 1, deadlineMs: 60_000 }).catch((error: unknown) => error);
    await ready(request.readyPath);
    const controller = new AbortController();
    const make = vi.fn(() => ({ kind: "echo", value: Buffer.alloc(1024) }));
    const queued = pool.run(make, { lane: "background", cost: 1, deadlineMs: 2000, signal: controller.signal }).catch((error: unknown) => error);
    expect(make).not.toHaveBeenCalled();

    controller.abort();
    expect(await queued).toBeInstanceOf(NativeJobRetiringError);
    expect(make).not.toHaveBeenCalled();
    expect(processExists(initial.pid)).toBe(true);
    await pool.destroy();
    expect(await blocked).toBeInstanceOf(NativeJobRetiringError);
    expect(make).not.toHaveBeenCalled();
  });

  it("destroys its native-blocked helper and descendant tree and cancels pending work", async () => {
    const pool = createPool();
    const initial = await echo(pool, "ready before tree");
    const request = await holdRequest("tree", true);
    const blocked = pool.run(() => request, { lane: "background", cost: 1, deadlineMs: 60_000 }).catch((error: unknown) => error);
    const owner = await ready(request.readyPath);
    expect(owner.pid).toBe(initial.pid);
    expect(owner.descendantPid).toBeTypeOf("number");
    expect(processExists(owner.pid)).toBe(true);
    expect(processExists(owner.descendantPid!)).toBe(true);
    const make = vi.fn(() => ({ kind: "echo", value: "never admitted" }));
    const pending = pool.run(make, { lane: "background", cost: 1, deadlineMs: 2000 }).catch((error: unknown) => error);

    await pool.destroy();

    expect(await blocked).toBeInstanceOf(NativeJobRetiringError);
    expect(await pending).toBeInstanceOf(Error);
    expect(make).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(processExists(owner.pid)).toBe(false);
      expect(processExists(owner.descendantPid!)).toBe(false);
    }, { timeout: 2000, interval: 10 });
    await expect(echo(pool, "after close")).rejects.toThrow("closing");
  });
});
