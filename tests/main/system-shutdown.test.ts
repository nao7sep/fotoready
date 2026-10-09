import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  quit: vi.fn(),
  exit: vi.fn(),
  listeners: new Map<string, Array<(event: { preventDefault(): void }) => void>>()
}));

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
    BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null },
    ipcMain: { handle() {}, removeHandler() {} },
    nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
    powerMonitor: new Emitter()
  };
});

const { installCloseGuard, installQuitShutdown } = await import("@main/bootstrap");

function fakeWindow(): EventEmitter & { webContents: { isDestroyed(): boolean; send(): void } } {
  return Object.assign(new EventEmitter(), { webContents: { isDestroyed: () => false, send() {} } });
}

beforeEach(() => {
  electron.quit.mockReset();
  electron.exit.mockReset();
  electron.listeners.clear();
});

describe("Windows session end", () => {
  // Windows raises no quit event and may end the process as soon as session-end returns.
  it("records what the quit has not finished and exits before the event returns", () => {
    const sessionEnded = vi.fn();
    const quit = installQuitShutdown({
      prepare: () => new Promise<boolean>(() => {}),
      answerForSessionEnd: () => {},
      stop: async () => true,
      sessionEnded
    });
    const win = fakeWindow();
    installCloseGuard(win as never, { reason: "unknown" }, quit);

    win.emit("session-end", { preventDefault() {} });

    expect(quit.sessionEnding()).toBe(true);
    expect(electron.quit).toHaveBeenCalledOnce();
    expect(sessionEnded).toHaveBeenCalledOnce();
    expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("stops listening for the session once the window has closed", () => {
    const quit = installQuitShutdown({
      prepare: async () => true,
      answerForSessionEnd: () => {},
      stop: async () => true,
      sessionEnded: () => {}
    });
    const win = fakeWindow();
    installCloseGuard(win as never, { reason: "unknown" }, quit);

    win.emit("closed");
    win.emit("query-session-end", { preventDefault() {} });
    win.emit("session-end", { preventDefault() {} });

    expect(quit.sessionEnding()).toBe(false);
    expect(electron.exit).not.toHaveBeenCalled();
  });
});
