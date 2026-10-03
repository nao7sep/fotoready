import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";
import type { RecordsReader } from "@main/records-reader";
import type { RecordsQuery } from "@shared/records";

// The Records window's channels, through the real IPC chokepoint with Electron's glue stubbed.

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, async (...args) => fn({}, ...args));
    }
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { isPackaged: false },
  shell: {},
  dialog: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false },
  screen: {}
}));

const { registerIpcHandlers } = await import("@main/ipc-router");

const ALL: RecordsQuery = { session: null, kind: null, level: null, taskId: null, search: "", after: null };
const read = vi.fn<RecordsReader["read"]>();
const openWindow = vi.fn(async () => undefined);
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() };
const project = { originals: [{ id: "o1", sourcePath: "/photos/harbour.jpg" }], tasks: [{ id: "task-1", originalId: "o1" }] };

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args);

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerIpcHandlers({
    logger,
    projectSession: { setSnapshotListener: () => {}, snapshot: () => ({ project }) },
    records: { reader: { read, close: async () => {} }, session: "s2", openWindow }
  } as unknown as RouterContext);
});

describe("records IPC", () => {
  it("reads a checked query, and logs nothing for a read that succeeded", async () => {
    read.mockResolvedValue({ records: [], more: false });
    await expect(invoke("records.page", { ...ALL, level: "attention", extra: 1 })).resolves.toEqual({ records: [], more: false });
    expect(read).toHaveBeenCalledWith({ op: "page", query: { ...ALL, level: "attention" } });
    expect([...logger.debug.mock.calls, ...logger.info.mock.calls]).toEqual([]);
  });

  it("refuses a malformed query before it reaches the database, and logs the failure", async () => {
    await expect(invoke("records.page", { ...ALL, kind: "notice" })).rejects.toThrow("query.kind");
    await expect(invoke("records.detail", "log", "7")).rejects.toThrow("id must be an integer.");
    expect(read).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("ipc records.page failed", expect.objectContaining({ channel: "records.page" }));
  });

  it("reads one record", async () => {
    read.mockResolvedValue(null);
    await expect(invoke("records.detail", "provider-call", 3)).resolves.toBeNull();
    expect(read).toHaveBeenCalledWith({ op: "detail", kind: "provider-call", id: 3 });
  });

  it("names this launch and the tasks still in the workspace", async () => {
    read.mockResolvedValue({ sessions: ["s2", "s1"], taskIds: ["task-1", "task-0"] });
    await expect(invoke("records.sources")).resolves.toEqual({
      currentSession: "s2",
      sessions: ["s2", "s1"],
      tasks: [{ taskId: "task-1", name: "harbour.jpg" }, { taskId: "task-0", name: null }]
    });
  });

  it("opens the window as a logged user action", async () => {
    await invoke("records.open");
    expect(openWindow).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("ipc records.open", expect.objectContaining({ channel: "records.open" }));
  });
});
