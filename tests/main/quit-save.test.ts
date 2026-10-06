import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUIT_SAVE_MS, UserWorkWrites, saveUserWorkBeforeQuit, type QuitChoice, type UserWork } from "@main/quit-save";

const SETTINGS: UserWork = { kind: "settings" };
const SIDECAR: UserWork = { kind: "sidecar", file: "photo.json" };

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: Error): void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  logger.info.mockReset();
  logger.error.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the save of the user's own work at quit", () => {
  it("waits for a running write and goes on without asking once it lands", async () => {
    const writes = new UserWorkWrites();
    const write = deferred();
    void writes.run(SETTINGS, () => write.promise);
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>();
    writes.beginQuit();

    const go = saveUserWorkBeforeQuit(writes, ask, () => false, logger);
    await vi.advanceTimersByTimeAsync(QUIT_SAVE_MS - 1);
    write.resolve();

    await expect(go).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("asks about a write that fails during the quit, and Retry writes it again", async () => {
    const writes = new UserWorkWrites();
    const write = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    writes.beginQuit();
    await expect(writes.run(SIDECAR, write)).rejects.toThrow("disk full");
    const ask = vi.fn(async () => "retry" as const);

    await expect(saveUserWorkBeforeQuit(writes, ask, () => false, logger)).resolves.toBe(true);

    expect(ask).toHaveBeenCalledExactlyOnceWith([SIDECAR]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith("the user's work was not saved before quit", expect.objectContaining({ failed: [SIDECAR], running: [] }));
  });

  it("asks again while Retry keeps failing, and Quit anyway goes on", async () => {
    const writes = new UserWorkWrites();
    writes.beginQuit();
    await expect(writes.run(SETTINGS, async () => { throw new Error("read-only"); })).rejects.toThrow("read-only");
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>()
      .mockResolvedValueOnce("retry")
      .mockResolvedValueOnce("quit");

    await expect(saveUserWorkBeforeQuit(writes, ask, () => false, logger)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("keeps FotoReady open on Cancel, and a cancelled quit forgets its failures", async () => {
    const writes = new UserWorkWrites();
    writes.beginQuit();
    await expect(writes.run(SETTINGS, async () => { throw new Error("read-only"); })).rejects.toThrow();

    await expect(saveUserWorkBeforeQuit(writes, async () => "cancel", () => false, logger)).resolves.toBe(false);
    writes.endQuit();

    expect(writes.unsaved()).toEqual({ failed: [], running: [] });
  });

  it("asks about a write still running once the bound runs out, naming each piece of work once", async () => {
    const writes = new UserWorkWrites();
    void writes.run(SIDECAR, () => new Promise<void>(() => {}));
    void writes.run(SIDECAR, () => new Promise<void>(() => {}));
    writes.beginQuit();
    const ask = vi.fn(async () => "quit" as const);

    const go = saveUserWorkBeforeQuit(writes, ask, () => false, logger);
    await vi.advanceTimersByTimeAsync(QUIT_SAVE_MS - 1);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(go).resolves.toBe(true);
    expect(ask).toHaveBeenCalledExactlyOnceWith([SIDECAR]);
  });

  it("never asks while the session is ending, and logs what it leaves", async () => {
    const writes = new UserWorkWrites();
    void writes.run(SETTINGS, () => new Promise<void>(() => {}));
    writes.beginQuit();
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>();

    const go = saveUserWorkBeforeQuit(writes, ask, () => true, logger);
    await vi.advanceTimersByTimeAsync(QUIT_SAVE_MS);

    await expect(go).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("the user's work was not saved before quit", expect.objectContaining({ running: [SETTINGS] }));
  });

  it("goes on when the session starts ending while the question is open", async () => {
    const writes = new UserWorkWrites();
    writes.beginQuit();
    await expect(writes.run(SETTINGS, async () => { throw new Error("read-only"); })).rejects.toThrow();
    let ending = false;
    const ask = vi.fn(async () => {
      ending = true;
      return "cancel" as const;
    });

    await expect(saveUserWorkBeforeQuit(writes, ask, () => ending, logger)).resolves.toBe(true);
  });

  it("keeps no failure from before the quit began, which was shown where it happened", async () => {
    const writes = new UserWorkWrites();
    await expect(writes.run(SETTINGS, async () => { throw new Error("read-only"); })).rejects.toThrow();
    writes.beginQuit();
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>();

    await expect(saveUserWorkBeforeQuit(writes, ask, () => false, logger)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});
