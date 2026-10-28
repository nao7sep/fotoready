import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveUserWorkBeforeQuit, type QuitChoice, type QuitDeadline, type UnsavedWrite, type UserWork } from "@main/quit-save";

const SETTINGS: UserWork = { kind: "settings" };
const SIDECAR: UserWork = { kind: "sidecar", file: "photo.json" };

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

// An owner of the user's own work as the quit sees it: it reports its latest write until that lands.
function owner(work: UserWork) {
  let latest: UnsavedWrite | null = null;
  const save = (write: () => Promise<void>): Promise<void> => {
    const settled = write();
    const entry: UnsavedWrite = { work, running: true, settled, retry: () => void save(write).catch(() => undefined) };
    latest = entry;
    settled.then(() => { if (latest === entry) latest = null; }, () => { entry.running = false; });
    return settled;
  };
  return { save, unsaved: (): UnsavedWrite[] => (latest ? [latest] : []) };
}

// The exit deadline as the quit's checks see it, run out by the test.
function deadline(): QuitDeadline & { runOut(): void; asks: number } {
  let runOut!: () => void;
  const ranOut = new Promise<void>((resolve) => { runOut = resolve; });
  const exit = {
    asks: 0,
    ask: <T>(question: () => Promise<T>): Promise<T> => {
      exit.asks += 1;
      return question();
    },
    within: (work: Promise<unknown>) => Promise.race([work.then(() => true, () => true), ranOut.then(() => false)]),
    runOut
  };
  return exit;
}

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  logger.info.mockReset();
  logger.error.mockReset();
});

describe("the save of the user's own work at quit", () => {
  it("waits for a running write and goes on without asking once it lands", async () => {
    const settings = owner(SETTINGS);
    const write = deferred();
    void settings.save(() => write.promise);
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>();

    const go = saveUserWorkBeforeQuit(settings.unsaved, deadline(), ask, () => false, logger);
    write.resolve();

    await expect(go).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("asks about a write that failed earlier in the session, and Retry writes it again", async () => {
    const sidecar = owner(SIDECAR);
    const write = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    await expect(sidecar.save(write)).rejects.toThrow("disk full");
    const ask = vi.fn(async () => "retry" as const);
    const exit = deadline();

    await expect(saveUserWorkBeforeQuit(sidecar.unsaved, exit, ask, () => false, logger)).resolves.toBe(true);

    expect(ask).toHaveBeenCalledExactlyOnceWith([SIDECAR]);
    expect(exit.asks).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(sidecar.unsaved()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith("the user's work was not saved before quit", expect.objectContaining({ failed: [SIDECAR], running: [] }));
  });

  it("asks again while Retry keeps failing, and Quit anyway goes on", async () => {
    const settings = owner(SETTINGS);
    await expect(settings.save(async () => { throw new Error("read-only"); })).rejects.toThrow("read-only");
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>()
      .mockResolvedValueOnce("retry")
      .mockResolvedValueOnce("quit");

    await expect(saveUserWorkBeforeQuit(settings.unsaved, deadline(), ask, () => false, logger)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("keeps FotoReady open on Cancel", async () => {
    const settings = owner(SETTINGS);
    await expect(settings.save(async () => { throw new Error("read-only"); })).rejects.toThrow();

    await expect(saveUserWorkBeforeQuit(settings.unsaved, deadline(), async () => "cancel", () => false, logger)).resolves.toBe(false);
  });

  it("asks about writes still running once the deadline runs out, naming each piece of work once", async () => {
    const first = owner(SIDECAR);
    const second = owner(SIDECAR);
    void first.save(() => new Promise<void>(() => {}));
    void second.save(() => new Promise<void>(() => {}));
    const ask = vi.fn(async () => "quit" as const);
    const exit = deadline();

    const go = saveUserWorkBeforeQuit(() => [...first.unsaved(), ...second.unsaved()], exit, ask, () => false, logger);
    await Promise.resolve();
    expect(ask).not.toHaveBeenCalled();
    exit.runOut();

    await expect(go).resolves.toBe(true);
    expect(ask).toHaveBeenCalledExactlyOnceWith([SIDECAR]);
  });

  it("never asks while the session is ending, and logs what it leaves", async () => {
    const settings = owner(SETTINGS);
    void settings.save(() => new Promise<void>(() => {}));
    const ask = vi.fn<(unsaved: UserWork[]) => Promise<QuitChoice>>();
    const exit = deadline();

    const go = saveUserWorkBeforeQuit(settings.unsaved, exit, ask, () => true, logger);
    exit.runOut();

    await expect(go).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("the user's work was not saved before quit", expect.objectContaining({ running: [SETTINGS] }));
  });

  it("goes on when the session starts ending while the question is open", async () => {
    const settings = owner(SETTINGS);
    await expect(settings.save(async () => { throw new Error("read-only"); })).rejects.toThrow();
    let ending = false;
    const ask = vi.fn(async () => {
      ending = true;
      return "cancel" as const;
    });

    await expect(saveUserWorkBeforeQuit(settings.unsaved, deadline(), ask, () => ending, logger)).resolves.toBe(true);
  });
});
