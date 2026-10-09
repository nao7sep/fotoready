import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Electron's quit, reduced to what the shutdown hold sees: before-quit, then (with the windows
// already closed) will-quit, and the process ends only if neither event was prevented.
const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  const state = { exits: 0, exitCalls: [] as number[] };
  const emit = (name: string): boolean => {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    for (const listener of listeners.get(name) ?? []) listener(event);
    return prevented;
  };
  const quit = vi.fn(() => {
    if (emit("before-quit")) return;
    if (emit("will-quit")) return;
    state.exits += 1;
  });
  const exit = vi.fn((code: number) => { state.exitCalls.push(code); });
  const power = new Map<string, (event: { preventDefault(): void }) => void>();
  return { listeners, state, quit, exit, power };
});

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", () => ({
  app: {
    on(name: string, listener: (event: { preventDefault(): void }) => void) {
      electron.listeners.set(name, [...(electron.listeners.get(name) ?? []), listener]);
    },
    off() {},
    quit: electron.quit,
    exit: electron.exit,
    isPackaged: false
  },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
  ipcMain: { handle() {}, removeHandler() {} },
  nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
  powerMonitor: {
    on(name: string, listener: (event: { preventDefault(): void }) => void) { electron.power.set(name, listener); },
    once() {},
    off() {}
  }
}));

const { followOsShutdown, installQuitShutdown, QUIT_DEADLINE_MS } = await import("@main/bootstrap");

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function steps(overrides: Partial<Parameters<typeof installQuitShutdown>[0]> = {}) {
  return {
    prepare: vi.fn(async () => true),
    answerForSessionEnd: vi.fn(),
    stop: vi.fn(async () => true),
    sessionEnded: vi.fn(),
    ...overrides
  };
}

beforeEach(() => {
  electron.listeners.clear();
  electron.state.exits = 0;
  electron.state.exitCalls = [];
  electron.quit.mockClear();
  electron.exit.mockClear();
});

describe("quit shutdown", () => {
  it("holds every quit while the checks and the stop run, and exits once after the stop", async () => {
    const prepared = deferred<boolean>();
    const stopped = deferred<boolean>();
    const quitSteps = steps({ prepare: vi.fn(() => prepared.promise), stop: vi.fn(() => stopped.promise) });
    const quit = installQuitShutdown(quitSteps);

    electron.quit();
    electron.quit();
    expect(quitSteps.prepare).toHaveBeenCalledOnce();
    expect(quit.approved()).toBe(false);

    prepared.resolve(true);
    await vi.waitFor(() => expect(quitSteps.stop).toHaveBeenCalledOnce());
    expect(quit.approved()).toBe(true);
    electron.quit();
    expect(quitSteps.stop).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);

    stopped.resolve(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(quitSteps.prepare).toHaveBeenCalledOnce();
  });

  it("stays open when the checks keep FotoReady open, and checks again on the next quit", async () => {
    const quitSteps = steps({ prepare: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) });
    installQuitShutdown(quitSteps);

    electron.quit();
    await vi.waitFor(() => expect(quitSteps.prepare).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(quitSteps.stop).not.toHaveBeenCalled();

    electron.quit();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(quitSteps.prepare).toHaveBeenCalledTimes(2);
  });

  it("starts the quit when the session ends, and answers a question already open instead", async () => {
    const quitSteps = steps();
    const quit = installQuitShutdown(quitSteps);

    quit.endSession();
    expect(quit.sessionEnding()).toBe(true);
    expect(quitSteps.answerForSessionEnd).toHaveBeenCalledOnce();
    expect(electron.quit).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));

    const asking = installQuitShutdown(steps({ prepare: () => new Promise<boolean>(() => {}) }));
    electron.quit.mockClear();
    electron.quit();
    asking.endSession();
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it("records what a Windows session end cut short and exits before returning", () => {
    const quitSteps = steps({ prepare: vi.fn(() => new Promise<boolean>(() => {})) });
    const quit = installQuitShutdown(quitSteps);

    quit.sessionEnded();

    expect(quitSteps.prepare).toHaveBeenCalledOnce();
    expect(quitSteps.sessionEnded).toHaveBeenCalledOnce();
    expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("the total exit deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is 5 s", () => {
    expect(QUIT_DEADLINE_MS).toBe(5_000);
  });

  it("ends an approved quit whose stop stalls, at the deadline counted from approval", async () => {
    const prepared = deferred<boolean>();
    const forceExit = vi.fn();
    installQuitShutdown(steps({ prepare: () => prepared.promise, stop: () => new Promise<boolean>(() => {}) }), { deadlineMs: 5_000, forceExit });

    electron.quit();
    // The questions and the save of the user's work come before approval, however long they take.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(forceExit).not.toHaveBeenCalled();

    prepared.resolve(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(forceExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);
  });

  it("ends an ending session at the deadline counted from the session end, even while its save is stalled", async () => {
    const forceExit = vi.fn();
    const quit = installQuitShutdown(steps({ prepare: () => new Promise<boolean>(() => {}) }), { deadlineMs: 5_000, forceExit });

    quit.endSession();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(forceExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forceExit).toHaveBeenCalledOnce();
  });

  it("is not extended by a later quit request or session end", async () => {
    const forceExit = vi.fn();
    const quit = installQuitShutdown(steps({ stop: () => new Promise<boolean>(() => {}) }), { deadlineMs: 5_000, forceExit });

    electron.quit();
    await vi.advanceTimersByTimeAsync(3_000);
    electron.quit();
    quit.endSession();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(forceExit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forceExit).toHaveBeenCalledOnce();
  });

  it("ends the process at once when the stop leaves tracked work unsettled, instead of the ordinary exit", async () => {
    const forceExit = vi.fn();
    installQuitShutdown(steps({ stop: async () => false }), { deadlineMs: 5_000, forceExit });

    electron.quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);
  });

  it("exits normally when everything settles in time, the user's work first and the stop after it", async () => {
    const forceExit = vi.fn();
    const order: string[] = [];
    const quit = installQuitShutdown(steps({
      prepare: async () => { await new Promise((resolve) => setTimeout(resolve, 2_000)); order.push("saved"); return true; },
      stop: async () => { order.push("stopped"); return true; }
    }), { deadlineMs: 5_000, forceExit });

    quit.endSession();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(order).toEqual(["saved", "stopped"]);
    expect(electron.state.exits).toBe(1);
    expect(forceExit).not.toHaveBeenCalled();
  });
});

describe("the OS shutdown on macOS and Linux", () => {
  it("starts the quit without asking the OS to wait", () => {
    const quit = { endSession: vi.fn() };
    followOsShutdown(quit);
    const event = { preventDefault: vi.fn() };
    electron.power.get("shutdown")!(event);
    expect(quit.endSession).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
