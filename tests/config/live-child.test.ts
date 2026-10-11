import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownLiveChild } from "../helpers/live-child";

function childDouble() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return { child, owner: ownLiveChild(child as unknown as ChildProcessWithoutNullStreams, "fixture") };
}

afterEach(() => { vi.useRealTimers(); });

describe("live-test child ownership", () => {
  it("recognizes a complete readiness line split across chunks before the wait", async () => {
    const { child, owner } = childDouble();
    child.stdout.write("rea");
    child.stdout.write("dy\r\n");
    await owner.waitReady();
    child.emit("close", 0, null);
    await owner.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("reports a spawn error that arrived before waiting without leaving a rejected close promise", async () => {
    const { child, owner } = childDouble();
    const failure = Object.assign(new Error("executable missing"), { code: "ENOENT" });
    child.emit("error", failure);
    child.emit("close", -2, null);
    await expect(owner.waitReady()).rejects.toMatchObject({ cause: failure });
    await owner.stop();
  });

  it("reports early process exit and its diagnostic instead of waiting for output", async () => {
    const { child, owner } = childDouble();
    const waiting = owner.waitReady();
    child.stderr.write("cannot acquire handle");
    child.emit("close", 1, null);
    await expect(waiting).rejects.toThrow("cannot acquire handle");
    await owner.stop();
  });

  it.each(["readiness", "exit"] as const)("kills a timed-out %s wait and awaits actual close before rejecting", async (phase) => {
    vi.useFakeTimers();
    const { child, owner } = childDouble();
    const waiting = phase === "readiness" ? owner.waitReady(100) : owner.waitClosed(100);
    let settled = false;
    const result = waiting.catch((error: Error) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    expect(await result).toMatchObject({ message: expect.stringContaining("timed out") });
    expect(settled).toBe(true);
  });
});
