import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from "@shared/layout/records-metrics";
import { RECORDS_CHANGED_CHANNEL } from "@shared/records";

class FakeWebContents extends EventEmitter {
  url = "";
  destroyed = false;
  send = vi.fn();
  isDestroyed = () => this.destroyed;
  getURL = () => this.url;
  setWindowOpenHandler = vi.fn();
}

class FakeWindow extends EventEmitter {
  static created: FakeWindow[] = [];
  static loadFailure: Error | null = null;
  options: Record<string, unknown>;
  webContents = new FakeWebContents();
  destroyed = false;
  minimized = false;
  visible = false;
  calls: string[] = [];
  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    FakeWindow.created.push(this);
  }
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  isVisible = () => this.visible;
  restore = () => void this.calls.push("restore");
  show = () => {
    this.visible = true;
    this.calls.push("show");
  };
  focus = () => void this.calls.push("focus");
  close = () => {
    this.destroyed = true;
    this.emit("closed");
  };
  destroy = () => {
    this.destroyed = true;
    this.emit("closed");
  };
  loadFile = vi.fn(async () => {
    if (FakeWindow.loadFailure) throw FakeWindow.loadFailure;
  });
  loadURL = vi.fn(async () => undefined);
}

const recovery = vi.hoisted(() => ({ names: [] as string[] }));
const minimum = vi.hoisted(() => vi.fn());
const activity = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: FakeWindow,
  nativeTheme: { shouldUseDarkColors: false }
}));
vi.mock("@main/window-state-recovery", () => ({
  createWindowWithUsablePersistedBounds: (name: string, create: () => unknown) => {
    recovery.names.push(name);
    return create();
  }
}));
vi.mock("@main/window-minimum", () => ({ configureWindowMinimum: minimum }));
vi.mock("@main/window-activity", () => ({ configureWindowActivity: activity }));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  FakeWindow.created = [];
  FakeWindow.loadFailure = null;
  recovery.names = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  const { closeRecordsWindow } = await import("@main/records-window");
  closeRecordsWindow();
});

describe("buildRecordsWindowOptions", () => {
  it("is a durable window of its own, sized from the shared layout", async () => {
    const { buildRecordsWindowOptions } = await import("@main/records-window");
    const options = buildRecordsWindowOptions("Records", "/tmp/preload.mjs");
    expect(options.name).toBe("records");
    expect(options.title).toBe("Records");
    expect(options.windowStatePersistence).toEqual({ bounds: true, displayMode: process.platform === "win32" });
    expect(options.minWidth).toBe(RECORDS_WINDOW_MIN_WIDTH);
    expect(options.minHeight).toBe(RECORDS_WINDOW_MIN_HEIGHT);
    expect(options.width).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_WIDTH);
    expect(options.height).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_HEIGHT);
    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({ preload: "/tmp/preload.mjs", contextIsolation: true, nodeIntegration: false });
  });
});

describe("openRecordsWindow", () => {
  it("opens one window, placed through the app's persisted-bounds recovery, shown once ready", async () => {
    const { openRecordsWindow } = await import("@main/records-window");
    await openRecordsWindow({ title: "Records", logger });

    expect(FakeWindow.created).toHaveLength(1);
    const [win] = FakeWindow.created;
    expect(recovery.names).toEqual(["records"]);
    expect(minimum).toHaveBeenCalledWith(win, expect.any(Function), expect.any(Function));
    expect(minimum.mock.calls[0]![1]()).toEqual({ width: RECORDS_WINDOW_MIN_WIDTH, height: RECORDS_WINDOW_MIN_HEIGHT });
    expect(activity).toHaveBeenCalledWith(expect.anything(), win);
    expect(win!.loadFile).toHaveBeenCalledWith(expect.stringMatching(/renderer[\\/]records\.html$/));
    expect(win!.visible).toBe(false);
    win!.emit("ready-to-show");
    expect(win!.visible).toBe(true);
  });

  it("brings the open window forward instead of opening a second", async () => {
    const { openRecordsWindow } = await import("@main/records-window");
    await openRecordsWindow({ title: "Records", logger });
    const [win] = FakeWindow.created;
    win!.minimized = true;
    win!.calls = [];

    await openRecordsWindow({ title: "Records", logger });

    expect(FakeWindow.created).toHaveLength(1);
    expect(win!.calls).toEqual(["restore", "show", "focus"]);
  });

  it("opens a new window once the last one has closed", async () => {
    const { openRecordsWindow, closeRecordsWindow } = await import("@main/records-window");
    await openRecordsWindow({ title: "Records", logger });
    closeRecordsWindow();
    await openRecordsWindow({ title: "Records", logger });
    expect(FakeWindow.created).toHaveLength(2);
  });

  it("destroys a window whose page failed to load, and reports the failure", async () => {
    const { openRecordsWindow } = await import("@main/records-window");
    FakeWindow.loadFailure = new Error("missing page");
    await expect(openRecordsWindow({ title: "Records", logger })).rejects.toThrow("missing page");
    expect(FakeWindow.created[0]!.destroyed).toBe(true);

    FakeWindow.loadFailure = null;
    await openRecordsWindow({ title: "Records", logger });
    expect(FakeWindow.created).toHaveLength(2);
  });

  it("blocks navigation away from its page", async () => {
    const { openRecordsWindow } = await import("@main/records-window");
    await openRecordsWindow({ title: "Records", logger });
    const { webContents } = FakeWindow.created[0]!;
    webContents.url = "file:///app/records.html";
    const away = { preventDefault: vi.fn() };
    const reload = { preventDefault: vi.fn() };
    webContents.emit("will-navigate", away, "https://example.com");
    webContents.emit("will-navigate", reload, "file:///app/records.html");
    expect(away.preventDefault).toHaveBeenCalled();
    expect(reload.preventDefault).not.toHaveBeenCalled();
    expect(webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: "deny" });
  });
});

describe("notifyRecordsChanged", () => {
  it("signals the open window, and does nothing while none is open", async () => {
    const { notifyRecordsChanged, openRecordsWindow, closeRecordsWindow } = await import("@main/records-window");
    expect(() => notifyRecordsChanged()).not.toThrow();

    await openRecordsWindow({ title: "Records", logger });
    const [win] = FakeWindow.created;
    notifyRecordsChanged();
    expect(win!.webContents.send).toHaveBeenCalledWith(RECORDS_CHANGED_CHANNEL);

    closeRecordsWindow();
    notifyRecordsChanged();
    expect(win!.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("never throws into the log write that called it", async () => {
    const { notifyRecordsChanged, openRecordsWindow } = await import("@main/records-window");
    await openRecordsWindow({ title: "Records", logger });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeWindow.created[0]!.webContents.send.mockImplementation(() => {
      throw new Error("render process gone");
    });
    expect(() => notifyRecordsChanged()).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
