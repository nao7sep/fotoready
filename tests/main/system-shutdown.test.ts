import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  quit: vi.fn(),
  powerMonitor: null as unknown as import("node:events").EventEmitter
}));

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  electron.powerMonitor = new Emitter();
  return {
    app: { on() {}, off() {}, quit: electron.quit, isPackaged: false },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle() {}, removeHandler() {} },
    nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
    powerMonitor: electron.powerMonitor
  };
});

const { installCloseGuard } = await import("@main/bootstrap");

function fakeWindow(): EventEmitter & { webContents: { isDestroyed(): boolean; send(): void } } {
  return Object.assign(new EventEmitter(), { webContents: { isDestroyed: () => false, send() {} } });
}

beforeEach(() => {
  vi.useFakeTimers();
  electron.quit.mockReset();
  electron.powerMonitor.removeAllListeners();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("system shutdown", () => {
  it.each(["powerMonitor shutdown", "query-session-end"])("on %s, holds the shutdown until the last state write lands, then quits", async (source) => {
    let finishWrite!: () => void;
    const prepareClose = vi.fn(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const exitState = { reason: "unknown" };
    const win = fakeWindow();
    installCloseGuard(win as never, exitState, prepareClose);

    const event = { preventDefault: vi.fn() };
    if (source === "powerMonitor shutdown") electron.powerMonitor.emit("shutdown", event);
    else win.emit("query-session-end", event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(exitState.reason).toBe("system-shutdown");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(electron.quit).not.toHaveBeenCalled();

    finishWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(electron.quit).toHaveBeenCalledOnce();
    expect(prepareClose).toHaveBeenCalledOnce();
  });

  it("quits anyway when the write does not land within the limit", async () => {
    const win = fakeWindow();
    installCloseGuard(win as never, { reason: "unknown" }, () => new Promise<void>(() => {}));

    win.emit("session-end", { preventDefault() {} });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(electron.quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(electron.quit).toHaveBeenCalledOnce();
  });

  it("acts once when Windows sends both session events", async () => {
    const prepareClose = vi.fn(async () => {});
    const win = fakeWindow();
    installCloseGuard(win as never, { reason: "unknown" }, prepareClose);

    win.emit("query-session-end", { preventDefault() {} });
    win.emit("session-end", { preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(prepareClose).toHaveBeenCalledOnce();
    expect(electron.quit).toHaveBeenCalledOnce();
  });
});
