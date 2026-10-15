import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  return { listeners, handlers, state, quit, exit: vi.fn() };
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
      exit: electron.exit,
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


const { confirmWorkspaceQuit, installCloseGuard, installQuitShutdown, prepareQuit } = await import("@main/bootstrap");
const { UserWorkWrites } = await import("@main/quit-save");

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
  const sessionEnded = vi.fn();
  let guard: ReturnType<typeof installCloseGuard> | null = null;
  const quit = installQuitShutdown({
    prepare: async () => {
      if (!quit.sessionEnding() && guard && !(await guard.confirmQuit())) return false;
      return save();
    },
    answerForSessionEnd: () => guard?.answerForSessionEnd(),
    stop,
    sessionEnded
  });
  const logger = { warn: vi.fn() };
  guard = installCloseGuard(win as never, exitState, quit, logger);
  const approve = (allow: boolean) => electron.handlers.get("lifecycle.approveClose")!({ sender: win }, allow, send.mock.calls.at(-1)?.[1]?.requestId);
  return { win, send, exitState, stop, quit, approve, logger, sessionEnded };
}

beforeEach(() => {
  vi.useFakeTimers();
  electron.exit.mockClear();
  electron.listeners.clear();
  electron.handlers.clear();
  electron.state.exits = 0;
  electron.quit.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("close guard quit", () => {
  it("asks the renderer once however often the user quits, and exits once after it approves", async () => {
    const { send, approve } = installApp();

    electron.quit();
    electron.quit();
    expect(send).toHaveBeenCalledExactlyOnceWith("lifecycle.close-requested", { requestId: 1 });

    await approve(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(send).toHaveBeenCalledOnce();
  });

  it("turns closing the window into the quit, which a declined confirmation cancels", async () => {
    const { win, send, exitState, approve, stop } = installApp();

    win.emit("close", { preventDefault() {} });
    expect(send).toHaveBeenCalledExactlyOnceWith("lifecycle.close-requested", { requestId: 1 });
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

  it("quits when the window closes on every platform, asking once however often it is closed", async () => {
    const { win, send, approve } = installApp();

    win.emit("close", { preventDefault() {} });
    win.emit("close", { preventDefault() {} });
    electron.quit();
    expect(send).toHaveBeenCalledOnce();
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
    const describing = {
      snapshot: () => ({ project: { originals: [{}], tasks: [{ visionRunning: true }] } }),
      queueSnapshot: () => ({ total: 1, queued: 0, processing: 0 }),
    };
    await confirmWorkspaceQuit(null, describing as never, ask);
    expect(ask).toHaveBeenLastCalledWith(true);
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

describe("Windows session events", () => {
  it("records interrupted work and exits synchronously when session-end arrives during a save", async () => {
    let finish!: (saved: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { win, send, sessionEnded, stop } = installApp(save);
    const event = { preventDefault: vi.fn() };
    win.emit("query-session-end", event);
    expect(save).toHaveBeenCalledOnce();
    win.emit("session-end", event);
    expect(sessionEnded).toHaveBeenCalledOnce();
    expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("handles session-end even when Windows sends no preceding query", () => {
    const { win, send, sessionEnded } = installApp(() => new Promise<boolean>(() => {}));
    const event = { preventDefault: vi.fn() };
    win.emit("session-end", event);
    expect(sessionEnded).toHaveBeenCalledOnce();
    expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("takes over an open renderer confirmation without asking again", async () => {
    const save = vi.fn(async () => true);
    const { win, send } = installApp(save);
    electron.quit();
    expect(send).toHaveBeenCalledOnce();
    const event = { preventDefault: vi.fn() };
    win.emit("query-session-end", event);
    win.emit("query-session-end", event);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(electron.state.exits).toBe(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("detaches session listeners and the approval handler when the window closes", () => {
    const { win } = installApp();
    win.emit("closed");
    expect(win.listenerCount("query-session-end")).toBe(0);
    expect(win.listenerCount("session-end")).toBe(0);
    expect(electron.handlers.has("lifecycle.approveClose")).toBe(false);
    win.emit("session-end", { preventDefault: vi.fn() });
    expect(electron.exit).not.toHaveBeenCalled();
  });
});

// Bootstrap's own quit checks, with the workspace question and the not-saved question as the only
// stubs: a question answers itself with its cancel choice when the session ends, as the dialogs do.
function installPreparedQuit({ windowless = false } = {}) {
  electron.state.window = null;
  const exitState = { reason: "unknown" };
  const userWork = new UserWorkWrites();
  const logger = { info: vi.fn(), error: vi.fn() };
  const stop = vi.fn(async () => true);
  let answerWorkspace: ((go: boolean) => void) | null = null;
  const confirmWorkspace = vi.fn(() => new Promise<boolean>((resolve) => { answerWorkspace = resolve; }));
  const askNotSaved = vi.fn(async () => "cancel" as const);
  const reasonAtStop: string[] = [];
  const quit = installQuitShutdown({
    prepare: () => prepareQuit({ userWork, exitState, sessionEnding: () => quit.sessionEnding(), confirmWorkspace, askNotSaved, logger }),
    // A renderer confirmation goes on with the quit; the windowless dialog gives its cancel choice.
    answerForSessionEnd: () => answerWorkspace?.(!windowless),
    stop: async () => { reasonAtStop.push(exitState.reason); return stop(); },
    sessionEnded: vi.fn()
  });
  return { exitState, userWork, logger, confirmWorkspace, askNotSaved, quit, reasonAtStop, answer: (go: boolean) => answerWorkspace?.(go) };
}

describe("bootstrap's quit checks", () => {
  it("on macOS logout, an OS quit asking about the workspace goes on when the power-off notice follows, recorded as a system shutdown", async () => {
    const { quit, confirmWorkspace, askNotSaved, reasonAtStop } = installPreparedQuit();
    electron.quit();
    expect(confirmWorkspace).toHaveBeenCalledOnce();
    quit.endSession();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(askNotSaved).not.toHaveBeenCalled();
    expect(reasonAtStop).toEqual(["system-shutdown"]);
  });

  it("with no main window, the session end cancels the workspace dialog and the quit still goes on", async () => {
    const { quit, reasonAtStop } = installPreparedQuit({ windowless: true });
    electron.quit();
    quit.endSession();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(reasonAtStop).toEqual(["system-shutdown"]);
  });

  it("asks nothing when the session is already ending", async () => {
    const { quit, confirmWorkspace, askNotSaved, userWork } = installPreparedQuit();
    let finish!: () => void;
    void userWork.run({ kind: "settings" }, () => new Promise<void>((resolve) => { finish = resolve; }));
    quit.endSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmWorkspace).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(askNotSaved).not.toHaveBeenCalled();
  });

  it("records an ordinary quit as the user's, and a declined one as no quit, keeping no failure for later", async () => {
    const { exitState, userWork, answer, reasonAtStop } = installPreparedQuit();
    electron.quit();
    expect(exitState.reason).toBe("user-quit");
    answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(exitState.reason).toBe("unknown");
    await userWork.run({ kind: "settings" }, async () => { throw new Error("disk full"); }).catch(() => undefined);
    expect(userWork.unsaved().failed).toEqual([]);

    electron.quit();
    answer(true);
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
    expect(reasonAtStop).toEqual(["user-quit"]);
  });

  it("keeps FotoReady open when the checks themselves fail, unless the session is ending", async () => {
    const { confirmWorkspace, logger, quit } = installPreparedQuit();
    const cause = new Error("cannot present");
    confirmWorkspace.mockRejectedValueOnce(cause);
    electron.quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith("quitting could not check the user's work", { mod: "main.quit", err: cause });
    expect(electron.state.exits).toBe(0);

    confirmWorkspace.mockRejectedValueOnce(cause);
    electron.quit();
    quit.endSession();
    await vi.waitFor(() => expect(electron.state.exits).toBe(1));
  });
});
