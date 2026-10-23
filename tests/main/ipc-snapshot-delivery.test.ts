import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { RouterContext } from "@main/ipc-router";
import type { OriginalImportResult, ProjectSnapshot, QueueSnapshot } from "@shared/types/ipc";
import { createEmptyProject } from "@shared/defaults";

const owned = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  origin: { webContents: { send: vi.fn() } },
  other: { webContents: { send: vi.fn() } },
  showOpenDialog: vi.fn()
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    owned.handlers.set(channel, (...args) => handler({ sender: owned.origin.webContents }, ...args));
  } },
  BrowserWindow: { getAllWindows: () => [owned.origin, owned.other], fromWebContents: () => owned.origin },
  dialog: { showOpenDialog: owned.showOpenDialog },
  app: { isPackaged: false }, shell: {}, screen: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }
}));
const { registerIpcHandlers } = await import("@main/ipc-router");

const snapshot = (revision: number): ProjectSnapshot => ({ revision, project: createEmptyProject(), activeTaskId: null, privacyWarnings: {} });
const queue = (): QueueSnapshot => ({ saved: 0, total: 0, notSaved: 0, queued: 0, processing: 0, errors: 0, activeTaskId: null, activeTaskLabel: null });
const call = (channel: string, ...args: unknown[]) => owned.handlers.get(channel)!(...args);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function arrange() {
  const selected = snapshot(2);
  const queued = queue();
  let listener!: (project: ProjectSnapshot, queues: QueueSnapshot) => void;
  const session = {
    snapshot: vi.fn(() => snapshot(99)),
    queueSnapshot: vi.fn(() => queued),
    selectTask: vi.fn(() => selected),
    addOriginals: vi.fn<(paths: string[], issues: unknown[]) => Promise<OriginalImportResult>>(),
    setSnapshotListener: (callback: typeof listener) => { listener = callback; }
  };
  const work = registerIpcHandlers({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    projectSession: session
  } as unknown as RouterContext);
  return { session, selected, queued, work, publish: (project: ProjectSnapshot, queues: QueueSnapshot) => listener(project, queues) };
}

beforeEach(() => {
  vi.clearAllMocks();
  owned.handlers.clear();
  owned.showOpenDialog.mockReset();
});

describe("IPC snapshot delivery", () => {
  it("returns the mutation's exact snapshot once to its origin and broadcasts project plus queue to other windows", async () => {
    const { session, selected, queued } = arrange();

    expect(await call("task.select", "task-1")).toBe(selected);

    expect(session.selectTask).toHaveBeenCalledWith("task-1");
    expect(session.snapshot).not.toHaveBeenCalled();
    expect(session.queueSnapshot).toHaveBeenCalledOnce();
    expect(owned.origin.webContents.send.mock.calls).toEqual([["queue.snapshot", queued]]);
    expect(owned.other.webContents.send.mock.calls).toEqual([["project.snapshot", selected], ["queue.snapshot", queued]]);
    expect(owned.other.webContents.send.mock.calls[0]![1]).toBe(selected);
  });

  it("delivers supplied background snapshots to every window without reading session state again", () => {
    const { session, publish } = arrange();
    const suppliedProject = snapshot(7);
    const suppliedQueue = { ...queue(), total: 1, queued: 1 };

    publish(suppliedProject, suppliedQueue);

    for (const window of [owned.origin, owned.other]) {
      expect(window.webContents.send.mock.calls).toEqual([["project.snapshot", suppliedProject], ["queue.snapshot", suppliedQueue]]);
      expect(window.webContents.send.mock.calls[0]![1]).toBe(suppliedProject);
      expect(window.webContents.send.mock.calls[1]![1]).toBe(suppliedQueue);
    }
    expect(session.snapshot).not.toHaveBeenCalled();
    expect(session.queueSnapshot).not.toHaveBeenCalled();
  });
});

describe("accepted original import activity", () => {
  it("counts overlapping accepted files until settlement, including a failed import", async () => {
    const { session, work } = arrange();
    const first = deferred<OriginalImportResult>();
    const second = deferred<OriginalImportResult>();
    session.addOriginals.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const importing = call("project.addOriginals", ["/one.png", "/two.jpg", "/one.png", "/unsupported.exe"]);
    const failure = new Error("import failed");
    const failed = expect(importing).rejects.toBe(failure);
    const overlapping = call("project.addOriginals", ["/three.webp"]);
    const activity = () => owned.origin.webContents.send.mock.calls.filter(([channel]) => channel === "originals.importActivity").map(([, count]) => count);
    expect(activity()).toEqual([2, 3]);
    expect(work.isIdle()).toBe(false);
    expect(session.addOriginals.mock.calls[0]![0]).toEqual([path.resolve("/one.png"), path.resolve("/two.jpg")]);

    first.reject(failure);
    await failed;
    expect(activity()).toEqual([2, 3, 1]);
    expect(work.isIdle()).toBe(false);
    const result: OriginalImportResult = { snapshot: snapshot(3), canceled: false, acceptedImages: 1, addedOriginals: 1, restoredTasks: 0, succeededPaths: ["/three.webp"], issues: [] };
    second.resolve(result);
    expect(await overlapping).toBe(result);

    expect(activity()).toEqual([2, 3, 1, 0]);
    expect(owned.other.webContents.send.mock.calls.filter(([channel]) => channel === "originals.importActivity")).toEqual([
      ["originals.importActivity", 2], ["originals.importActivity", 3], ["originals.importActivity", 1], ["originals.importActivity", 0]
    ]);
    expect(work.isIdle()).toBe(true);
  });

  it("does not count an open picker or its cancelled selection as pending import work", async () => {
    const { session, work } = arrange();
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>();
    owned.showOpenDialog.mockReturnValueOnce(picker.promise);
    const choosing = call("project.addOriginalsFromDialog");
    expect(owned.origin.webContents.send).not.toHaveBeenCalled();
    expect(owned.other.webContents.send).not.toHaveBeenCalled();

    picker.resolve({ canceled: true, filePaths: [] });
    expect(await choosing).toMatchObject({ canceled: true, addedOriginals: 0 });
    expect(session.addOriginals).not.toHaveBeenCalled();
    expect(owned.origin.webContents.send).not.toHaveBeenCalled();
    expect(owned.other.webContents.send).not.toHaveBeenCalled();
    expect(work.isIdle()).toBe(true);
  });
});
