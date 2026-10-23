import { fork, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { PipelineError } from "@runtime/pipeline-error";

export type NativeLane = "interactive" | "background";
/** Caller settlement does not release the process's memory or output ownership. */
export class NativeJobRetiringError extends PipelineError {
  readonly code = "ETIMEDOUT";
  constructor(message: string) { super("io", message); }
}

type Job = {
  make(): object;
  lane: NativeLane;
  cost: number;
  deadlineMs: number;
  outputPath?: string;
  resolve(result: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};
// A cold helper loads Node, Sharp and font libraries before its first measured result.
const COLD_PROCESS_BYTES = 128 * 1024 * 1024;
type Slot = { child: ChildProcess; job: Job | null; residentBytes: number; retiring: boolean; exited: Promise<void> };

/** Native work has one physical owner until the owned child exits, even after a caller times out. */
export class NativeProcessPool {
  readonly capacity: number;
  readonly backgroundCapacity: number;
  #slots = new Set<Slot>();
  #waiting: Job[] = [];
  #closed = false;
  constructor(private readonly filename: string, cores: number, private readonly totalMemory = os.totalmem()) {
    this.capacity = Math.max(2, cores);
    this.backgroundCapacity = Math.max(1, this.capacity - 1);
  }

  run<T>(make: () => object, options: { lane: NativeLane; cost: number; deadlineMs: number; queueMs?: number; signal?: AbortSignal; outputPath?: string }): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("FotoReady is closing; no new image work starts."));
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    return new Promise<T>((resolve, reject) => {
      const job: Job = { ...options, make, resolve: resolve as (result: unknown) => void, reject,
        timer: setTimeout(() => this.#cancel(job, Object.assign(new PipelineError("io", "Image work could not start before its queue deadline."), { code: "ETIMEDOUT" })), options.queueMs ?? 60_000) };
      job.abort = () => this.#cancel(job, new NativeJobRetiringError("Image work was stopped; its process is retiring."));
      job.signal?.addEventListener("abort", job.abort, { once: true });
      this.#waiting.push(job);
      this.#pump();
    });
  }

  async destroy(): Promise<void> {
    this.#closed = true;
    for (const job of [...this.#waiting]) this.#cancel(job, new Error("FotoReady is closing."));
    const slots = [...this.#slots];
    for (const slot of slots) this.#retire(slot, new NativeJobRetiringError("Image work was stopped for shutdown."));
    await Promise.all(slots.map((slot) => slot.exited));
  }

  #finish(job: Job): void {
    clearTimeout(job.timer);
    if (job.abort) job.signal?.removeEventListener("abort", job.abort);
  }

  #cancel(job: Job, error: Error): void {
    const index = this.#waiting.indexOf(job);
    if (index >= 0) {
      this.#waiting.splice(index, 1);
      this.#finish(job);
      job.reject(error);
      this.#pump();
      return;
    }
    const slot = [...this.#slots].find((item) => item.job === job);
    if (slot) this.#retire(slot, error);
  }

  #pump(): void {
    if (this.#closed) return;
    for (;;) {
      const active = [...this.#slots].filter((slot) => slot.job);
      const backgrounds = active.filter((slot) => slot.job!.lane === "background");
      const available = [...this.#slots].filter((candidate) => !candidate.job && !candidate.retiring);
      // Reuse the largest resident helper so a previous heavy save does not sit beside a new one.
      let slot = available.sort((a, b) => b.residentBytes - a.residentBytes)[0];
      const canRun = (job: Job): boolean => job.lane === "interactive"
        ? active.every((slot) => slot.job!.lane !== "interactive")
        : backgrounds.length < this.backgroundCapacity;
      let index = this.#waiting.findIndex((job) => job.lane === "interactive" && canRun(job));
      if (index < 0) index = this.#waiting.findIndex((job) => job.lane === "background");
      if (index < 0 || !canRun(this.#waiting[index]!)) return;
      const candidate = this.#waiting[index]!;
      const used = [...this.#slots].reduce((sum, item) => sum + Math.max(item.residentBytes, item.job?.cost ?? 0), 0);
      const projected = used - (slot?.residentBytes ?? 0) + Math.max(slot?.residentBytes ?? COLD_PROCESS_BYTES, candidate.cost);
      // Text and preview caches each have a 2.5% retained allowance. Background execution uses
      // 45%, including idle native allocations reported by helpers, leaving half for UI and OS.
      // Retire idle allocations before extra background admission; physical exit releases the charge.
      if (candidate.lane === "background" && projected > this.totalMemory * 0.45) {
        for (const idle of available) if (idle !== slot) this.#retire(idle, new Error("Releasing idle image memory."));
        if (backgrounds.length > 0 || [...this.#slots].some((item) => item.retiring)) return;
        // A first save still starts even when one photo exceeds the ordinary memory share.
      }
      if (!slot) {
        if (this.#slots.size >= this.capacity) return;
        try { slot = this.#createSlot(); }
        catch (error) {
          const [failed] = this.#waiting.splice(index, 1);
          this.#finish(failed!);
          failed!.reject(Object.assign(new PipelineError("io", `The image process could not start: ${String(error)}`), { code: "EIO" }));
          continue;
        }
      }
      const [job] = this.#waiting.splice(index, 1);
      slot.job = job!;
      clearTimeout(job!.timer);
      job!.timer = setTimeout(() => this.#retire(slot!, new NativeJobRetiringError("Image work exceeded its execution deadline; its process is retiring.")), job!.deadlineMs);
      try {
        // Copies of raw bitmaps are made here, only after actual admission.
        slot.child.send(job!.make(), (error) => { if (error) this.#retire(slot!, error); });
      } catch (error) { this.#retire(slot, error instanceof Error ? error : new Error(String(error))); }
    }
  }

  #createSlot(): Slot {
    // Each owned child has its own process group so its ExifTool descendants are retired too.
    const child = fork(this.filename, [], { serialization: "advanced", detached: process.platform !== "win32",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", FOTOREADY_TEXT_CACHE_BYTES: String(Math.floor(this.totalMemory * 0.025 / this.capacity)) },
      stdio: ["ignore", "inherit", "inherit", "ipc"] });
    let onExit!: () => void;
    const slot: Slot = { child, job: null, residentBytes: COLD_PROCESS_BYTES, retiring: false, exited: new Promise<void>((resolve) => { onExit = resolve; }) };
    this.#slots.add(slot);
    child.on("message", (result) => {
      if (slot.retiring || !slot.job) return;
      const job = slot.job;
      const measured = (result as { residentBytes?: number }).residentBytes;
      slot.residentBytes = typeof measured === "number" && Number.isFinite(measured) && measured > 0
        ? measured : Math.max(slot.residentBytes, job.cost);
      slot.job = null;
      this.#finish(job);
      job.resolve(result);
      this.#pump();
    });
    child.once("error", (error) => this.#retire(slot, error));
    // Failed spawning can emit close without exit; either is final physical settlement.
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      const job = slot.job;
      if (job) {
        this.#finish(job);
        job.reject(Object.assign(new PipelineError("io", "The image process exited before completing its work."), { code: "EIO" }));
        // A timed-out native operation can no longer write this unique staging path after exit.
        if (job.outputPath) void fs.rm(job.outputPath, { force: true }).catch((error) => console.warn("[image-worker] could not remove retired output", { path: job.outputPath, error }));
      }
      this.#slots.delete(slot);
      onExit();
      this.#pump();
    };
    child.once("exit", settle);
    child.once("close", settle);
    return slot;
  }

  #retire(slot: Slot, error: Error): void {
    if (slot.retiring) return;
    slot.retiring = true;
    if (slot.job) {
      this.#finish(slot.job);
      // All rejected active jobs carry the ownership distinction, including send/process failures.
      slot.job.reject(error instanceof NativeJobRetiringError ? error : new NativeJobRetiringError(error.message));
    }
    const pid = slot.child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        killer.once("error", (cause) => console.warn("[image-worker] owned process tree could not be retired", { pid, cause }));
      } else process.kill(-pid, "SIGKILL");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") console.warn("[image-worker] owned process could not be retired", { pid, cause });
    }
  }
}
