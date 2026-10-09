import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Electron's quit, reduced to what the close guard and the shutdown hold see: before-quit, then the
// windows close (each close can be prevented), then will-quit, and the process ends only if
// nothing was prevented.
const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => Promise<void>>();
  const state = { exits: 0, window: null as null | { emit(name: string, event: unknown): boolean } };
  const emit = (name: string): boolean => {
    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
    return prevented;
  };
  const quit = vi.fn(() => {
    if (emit("before-quit")) return;
    let closePrevented = false;
    state.window?.emit("close", { preventDefault: () => { closePrevented = true; } });
    if (closePrevented) return;
    if (emit("will-quit")) return;
    state.exits += 1;
  });
  return { listeners, handlers, state, quit, closeQuits: { value: true } };
});

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    app: {
      on(name: string, listener: (event: { preventDefault(): void }) => void) {
        electron.listeners.set(name, [...(electron.listeners.get(name) ?? []), listener]);
      },
      off() {},
      quit: electron.quit,
      exit: vi.fn(),
      isPackaged: false
    },
    BrowserWindow: { fromWebContents: () => electron.state.window, getFocusedWindow: () => null },
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

// Whether closing the last window quits: off macOS it does, on macOS the app goes on.
vi.mock("@main/window-close", () => ({ windowCloseQuits: () => electron.closeQuits.value }));

const { confirmWorkspaceQuit, installCloseGuard, installQuitShutdown } = await import("@main/bootstrap");

function fakeWindow() {
  const send = vi.fn();
  const win = Object.assign(new EventEmitter(), {
    webContents: { isDestroyed: () => false, send },
    isMinimized: () => false,
    restore() {},
    isVisible: () => true,
    show() {},
    focus() {},
    close: vi.fn()
  });
  electron.state.window = win;
  return { win, send };
}

// The app's quit as bootstrap wires it, with the save of the user's own work stubbed.
function installApp(save: () => Promise<boolean> = async () => true) {
  const { win, send } = fakeWindow();
  const exitState = { reason: "unknown" };
  const stop = vi.fn(async () => true);
  let guard: ReturnType<typeof installCloseGuard> | null = null;
  const quit = installQuitShutdown({
    prepare: async () => {
      if (!quit.sessionEnding() && guard && !(await guard.confirmQuit())) return false;
      return save();
    },
    answerForSessionEnd: () => guard?.answerForSessionEnd(),
    stop,
    sessionEnded: () => {}
  });
  const logger = { warn: vi.fn() };
  guard = installCloseGuard(win as never, exitState, quit, logger);
  const approve = (allow: boolean) => electron.handlers.get("lifecycle.approveClose")!({ sender: win }, allow, send.mock.calls.at(-1)?.[1]?.requestId);
  return { win, send, exitState, stop, quit, approve, logger };
}

beforeEach(() => {
  electron.listeners.clear();
  electron.handlers.clear();
  electron.state.exits = 0;
  electron.closeQuits.value = true;
  electron.quit.mockClear();
});

describe("close guard quit", () => {
  it("asks the renderer once however often the user quits, and exits once after it approves", async () => {
    const { send, approve } = installApp();

    electron.quit();
    electron.quit();
    expect(send).toHaveBeenCalledExactlyOnceWith("lifecycle.close-requested", { endsApp: true, requestId: 1 });

    await approve(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(send).toHaveBeenCalledOnce();
  });

  it("turns closing the window off macOS into the quit, which a declined confirmation cancels", async () => {
    const { win, send, exitState, approve, stop } = installApp();

    win.emit("close", { preventDefault() {} });
    expect(send).toHaveBeenCalledExactlyOnceWith("lifecycle.close-requested", { endsApp: true, requestId: 1 });
    expect(exitState.reason).toBe("window-close");

    await approve(false);
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();

    win.emit("close", { preventDefault() {} });
    expect(send).toHaveBeenCalledTimes(2);
    await approve(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
  });

  it("keeps the window open when the user cancels at the unsaved-work question", async () => {
    const save = vi.fn(async () => false);
    const { win, approve, stop } = installApp(save);

    win.emit("close", { preventDefault() {} });
    await approve(true);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(electron.state.exits).toBe(0);
  });

  it("closes only the window on macOS", async () => {
    electron.closeQuits.value = false;
    const { win, send, approve } = installApp();

    win.emit("close", { preventDefault() {} });
    expect(send).toHaveBeenCalledExactlyOnceWith("lifecycle.close-requested", { endsApp: false, requestId: 1 });
    await approve(true);
    expect(win.close).toHaveBeenCalledOnce();
    expect(electron.quit).not.toHaveBeenCalled();
  });

  it("on macOS, lets a quit arriving while a window close is asked join that question", async () => {
    electron.closeQuits.value = false;
    const { win, send, approve } = installApp();

    win.emit("close", { preventDefault() {} });
    electron.quit();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("lifecycle.close-requested", { endsApp: true, requestId: 2 });
    await electron.handlers.get("lifecycle.approveClose")!({ sender: win }, true, 1);
    await Promise.resolve();
    expect(electron.state.exits).toBe(0);
    await approve(true);

    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(win.close).not.toHaveBeenCalled();
  });

  it("cancels quit when the renderer closes before answering", async () => {
    const { win, stop } = installApp();
    electron.quit();
    win.emit("closed");
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(electron.state.exits).toBe(0);
  });

  it("cancels when sending the required close question fails", async () => {
    const { send, stop, logger } = installApp();
    const cause = new Error("renderer unavailable");
    send.mockImplementation(() => { throw cause; });
    electron.quit();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("the close question could not be presented", { mod: "main.quit", err: cause });
  });

  it("asks about the process-owned workspace without creating a main window", async () => {
    const ask = vi.fn(async () => false);
    const session = {
      snapshot: () => ({ project: { originals: [{}], tasks: [] } }),
      queueSnapshot: () => ({ total: 1, queued: 1, processing: 0 }),
    };
    await expect(confirmWorkspaceQuit(null, session as never, ask)).resolves.toBe(false);
    expect(ask).toHaveBeenCalledWith(true);
    ask.mockRejectedValueOnce(new Error("cannot present"));
    await expect(confirmWorkspaceQuit(null, session as never, ask)).rejects.toThrow("cannot present");
    expect(electron.state.exits).toBe(0);
  });

  it("never refuses a Windows session end, and quits without asking the renderer", async () => {
    const { win, send, quit } = installApp();
    const query = { preventDefault: vi.fn() };

    win.emit("query-session-end", query);
    win.emit("query-session-end", query);

    expect(query.preventDefault).not.toHaveBeenCalled();
    expect(quit.sessionEnding()).toBe(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(send).not.toHaveBeenCalled();
  });

  it("answers a confirmation already open when the session ends, and goes on with the quit", async () => {
    const { send, quit } = installApp();

    electron.quit();
    expect(send).toHaveBeenCalledOnce();
    quit.endSession();

    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
  });
});
