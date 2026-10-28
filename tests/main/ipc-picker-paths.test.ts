import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";
import { createEmptyProject } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";
import { ipcFailure } from "@shared/ipc-failure";
import { message } from "@shared/i18n/translate";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showOpenDialog: vi.fn(),
  owner: { webContents: { send: vi.fn() } }
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    mocks.handlers.set(name, (...args) => handler({ sender: {} }, ...args));
  } },
  BrowserWindow: { fromWebContents: () => mocks.owner, getAllWindows: () => [] },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  app: { isPackaged: false }, shell: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }, screen: {}
}));
const { registerIpcHandlers } = await import("@main/ipc-router");
let project = createEmptyProject();
let activeTaskId: string | null = null;
const setOutputDir = vi.fn((dir: string) => { project.outputDir = dir; return snapshot(); });
const snapshot = () => ({ project, activeTaskId });
const call = (channel: string, options?: unknown) => mocks.handlers.get(channel)!(options);
const options = () => mocks.showOpenDialog.mock.calls.at(-1)![1];
const source = (id: string, sourcePath: string) => ({ id, sourcePath }) as Original;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("FOTOREADY_PICKER_ROOT", path.join(os.homedir(), "picker-root"));
  vi.stubEnv("FOTOREADY_PICKER_MISSING", undefined);
  project = createEmptyProject();
  activeTaskId = null;
  mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  registerIpcHandlers({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: {}, settings: {},
    projectSession: { setSnapshotListener: () => {}, snapshot, queueSnapshot: () => ({}), project: () => project, setOutputDir },
    records: { reader: {}, session: "s1", openWindow: vi.fn() }
  } as unknown as RouterContext);
});

describe("native picker paths", () => {
  it.each(["system.pickFile", "system.pickDirectory"])("resolves %s authored hints using Home and keeps the native owner", async (channel) => {
    for (const [authored, expected] of [
      [path.join(os.homedir(), " literal folder "), path.join(os.homedir(), " literal folder ")],
      ["  ~/art/logo.png  ", path.join(os.homedir(), "art/logo.png")],
      ["~/art/logo.png", path.join(os.homedir(), "art/logo.png")],
      ["$FOTOREADY_PICKER_ROOT/art", path.join(os.homedir(), "picker-root/art")],
      ["art", path.join(os.homedir(), "art")],
      [path.join(os.homedir(), "$FOTOREADY_PICKER_MISSING", "%literal%"), path.join(os.homedir(), "$FOTOREADY_PICKER_MISSING", "%literal%")]
    ]) {
      await call(channel, { title: "Choose", extensions: ["png"], defaultPath: authored });
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(mocks.owner, expect.objectContaining({ defaultPath: expected }));
    }
  });

  it("keeps generic file imports and empty picks generic", async () => {
    for (const channel of ["system.pickFile", "system.pickFiles", "system.pickDirectory"]) {
      await call(channel, { title: "Import", extensions: ["png"] });
      expect(options().defaultPath).toBeUndefined();
    }
  });

  it.each(["system.pickFile", "system.pickDirectory"])("returns literal %s selections and null on cancel", async (channel) => {
    const picked = path.join(os.homedir(), " $FOTOREADY_PICKER_MISSING %literal% ");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] });
    await expect(call(channel, { title: "Choose", extensions: ["png"] })).resolves.toBe(picked);
    await expect(call(channel, { title: "Choose", extensions: ["png"] })).resolves.toBeNull();
  });

  it("reports unset authored variables without opening the dialog", async () => {
    await expect(call("system.pickDirectory", { title: "Choose", defaultPath: "$FOTOREADY_PICKER_MISSING/out" })).resolves.toEqual(
      ipcFailure(message("failure.pathVariable", { variable: "FOTOREADY_PICKER_MISSING" }))
    );
    expect(mocks.showOpenDialog).not.toHaveBeenCalled();
  });
});

describe("output picker context", () => {
  beforeEach(() => {
    project.originals = [source("a", path.join(os.homedir(), "photos/a.jpg")), source("b", path.join(os.homedir(), "other/b.jpg"))];
    project.tasks = [{ id: "task-b", originalId: "b" } as Task];
    activeTaskId = "task-b";
  });

  it("uses the active source for draft output expressions and blank's beside-source default", async () => {
    project.outputDir = "/saved/output";
    await call("system.pickDirectory", { title: "Output", defaultPath: "draft/out", purpose: "output" });
    expect(options().defaultPath).toBe(path.join(os.homedir(), "other/draft/out"));
    await call("system.pickDirectory", { title: "Output", defaultPath: "", purpose: "output" });
    expect(options().defaultPath).toBe(path.join(os.homedir(), "other"));
  });

  it("uses the project destination and leaves it unchanged on cancel, then uses the newly picked path", async () => {
    project.outputDir = "out";
    await expect(call("project.setOutputDirFromDialog")).resolves.toEqual({ cancelled: true });
    expect(options().defaultPath).toBe(path.join(os.homedir(), "other/out"));
    expect(setOutputDir).not.toHaveBeenCalled();
    const picked = path.join(os.homedir(), "$FOTOREADY_PICKER_MISSING", " output ");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] });
    await call("project.setOutputDirFromDialog");
    expect(setOutputDir).toHaveBeenCalledWith(picked);
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBe(picked);
  });

  it("uses a common source parent, otherwise omits an ambiguous relative hint", async () => {
    activeTaskId = null;
    project.outputDir = "out";
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBeUndefined();
    vi.stubEnv("FOTOREADY_PICKER_ROOT", "relative-exports");
    project.outputDir = "$FOTOREADY_PICKER_ROOT";
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBeUndefined();
    project.outputDir = "out";
    project.originals[1]!.sourcePath = path.join(os.homedir(), "photos/b.jpg");
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBe(path.join(os.homedir(), "photos/out"));
  });

  it("keeps absolute and Home expressions useful without any original", async () => {
    project.originals = [];
    project.outputDir = "~/exports";
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBe(path.join(os.homedir(), "exports"));
    project.outputDir = null;
    await call("project.setOutputDirFromDialog");
    expect(options().defaultPath).toBeUndefined();
  });
});
