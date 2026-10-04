import { beforeEach, describe, expect, it, vi } from "vitest";

// Electron's quit, reduced to what the shutdown hold sees: before-quit, then (with the windows
// already closed) will-quit, and the process ends only if neither event was prevented.
const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  const state = { exits: 0 };
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
  return { listeners, state, quit };
});

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", () => ({
  app: {
    on(name: string, listener: (event: { preventDefault(): void }) => void) {
      electron.listeners.set(name, [...(electron.listeners.get(name) ?? []), listener]);
    },
    off() {},
    quit: electron.quit,
    isPackaged: false
  },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle() {}, removeHandler() {} },
  nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
  powerMonitor: { on() {}, once() {}, off() {} }
}));

const { installQuitShutdown } = await import("@main/bootstrap");

beforeEach(() => {
  electron.listeners.clear();
  electron.state.exits = 0;
  electron.quit.mockClear();
});

describe("quit shutdown", () => {
  it("holds a second quit during a pending shutdown and exits only after the shutdown settles", async () => {
    let finishStop!: () => void;
    const stop = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    installQuitShutdown(stop);

    electron.quit();
    expect(stop).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);

    electron.quit();
    expect(stop).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);

    finishStop();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("holds a repeat quit at before-quit, so it never reaches will-quit again", async () => {
    let finishStop!: () => void;
    installQuitShutdown(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const willQuit = vi.fn();
    electron.listeners.get("will-quit")!.push(willQuit);

    electron.quit();
    electron.quit();
    expect(willQuit).toHaveBeenCalledOnce();

    finishStop();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
  });
});
