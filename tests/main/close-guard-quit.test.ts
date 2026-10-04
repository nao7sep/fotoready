import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Electron's quit, reduced to what the close guard and the shutdown hold see: before-quit, then
// (with the windows already closed) will-quit, and the process ends only if neither was prevented.
const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => Promise<void>>();
  const state = { exits: 0, window: null as unknown };
  const emit = (name: string): boolean => {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
    return prevented;
  };
  const quit = vi.fn(() => {
    if (emit("before-quit")) return;
    if (emit("will-quit")) return;
    state.exits += 1;
  });
  return { listeners, handlers, state, quit };
});

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    app: {
      on(name: string, listener: (event: { preventDefault(): void }) => void) {
        electron.listeners.set(name, [...(electron.listeners.get(name) ?? []), listener]);
      },
      off(name: string, listener: (event: { preventDefault(): void }) => void) {
        electron.listeners.set(name, (electron.listeners.get(name) ?? []).filter((l) => l !== listener));
      },
      quit: electron.quit,
      isPackaged: false
    },
    BrowserWindow: { fromWebContents: () => electron.state.window },
    ipcMain: {
      handle(channel: string, handler: (event: { sender: unknown }, ...args: unknown[]) => Promise<void>) {
        electron.handlers.set(channel, handler);
      },
      removeHandler(channel: string) { electron.handlers.delete(channel); }
    },
    nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
    powerMonitor: new Emitter()
  };
});

const { installCloseGuard, installQuitShutdown } = await import("@main/bootstrap");

function fakeWindow() {
  const send = vi.fn();
  const win = Object.assign(new EventEmitter(), {
    webContents: { isDestroyed: () => false, send },
    isMinimized: () => false,
    restore() {},
    isVisible: () => true,
    show() {},
    focus() {},
    close() {}
  });
  electron.state.window = win;
  return { win, send };
}

beforeEach(() => {
  electron.listeners.clear();
  electron.handlers.clear();
  electron.state.exits = 0;
  electron.quit.mockClear();
});

describe("close guard quit", () => {
  it("holds a second quit after an approved quit without asking again, and exits once after the save", async () => {
    const { win, send } = fakeWindow();
    let finishWrite!: () => void;
    const prepareClose = vi.fn(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const exitState = { reason: "unknown" };
    installQuitShutdown(async () => {});
    installCloseGuard(win as never, exitState, prepareClose);

    electron.quit();
    expect(send).toHaveBeenCalledOnce();

    const approved = electron.handlers.get("lifecycle.approveClose")!({ sender: win }, true);
    electron.quit();
    expect(send).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(0);

    finishWrite();
    await approved;
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(send).toHaveBeenCalledOnce();
    expect(prepareClose).toHaveBeenCalledOnce();
    expect(exitState.reason).toBe("user-quit");
  });

  it("turns an approved window close into the quit that arrives while it saves", async () => {
    const { win, send } = fakeWindow();
    const close = vi.spyOn(win, "close");
    let finishWrite!: () => void;
    const exitState = { reason: "unknown" };
    installQuitShutdown(async () => {});
    installCloseGuard(win as never, exitState, () => new Promise<void>((resolve) => { finishWrite = resolve; }));

    win.emit("close", { preventDefault() {} });
    const approved = electron.handlers.get("lifecycle.approveClose")!({ sender: win }, true);
    electron.quit();
    win.emit("close", { preventDefault() {} });
    expect(send).toHaveBeenCalledOnce();

    finishWrite();
    await approved;
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(close).not.toHaveBeenCalled();
    expect(exitState.reason).toBe("user-quit");
  });
});
