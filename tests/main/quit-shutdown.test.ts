import { beforeEach, describe, expect, it, vi } from "vitest";

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
  return { listeners, state, quit, exit };
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
  powerMonitor: { on() {}, once() {}, off() {} }
}));

const { installQuitShutdown } = await import("@main/bootstrap");

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function steps(overrides: Partial<Parameters<typeof installQuitShutdown>[0]> = {}) {
  return {
    prepare: vi.fn(async () => true),
    answerForSessionEnd: vi.fn(),
    stop: vi.fn(async () => {}),
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
    const stopped = deferred<void>();
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

    stopped.resolve();
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
