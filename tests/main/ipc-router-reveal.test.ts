import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";

// Revealing the output folder hands Finder or Explorer an existing absolute path, through the real
// IPC chokepoint with Electron's glue stubbed.

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showItemInFolder: vi.fn()
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, async (...args) => fn({}, ...args));
    }
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { isPackaged: false },
  shell: { showItemInFolder: electron.showItemInFolder },
  dialog: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false },
  screen: {}
}));

const { registerIpcHandlers } = await import("@main/ipc-router");

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() };
let root: string;
let originals: { id: string; sourcePath: string }[];
let tasks: { id: string; originalId: string }[];
let activeTaskId: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  electron.handlers.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-reveal-"));
  originals = [];
  tasks = [];
  activeTaskId = null;
  registerIpcHandlers({
    logger,
    settings: { lutFolder: "", stampFolder: "" },
    paths: { lutsDir: "/unused/luts", bundledLutsDir: "/unused/bundled-luts", stampsDir: "/unused/stamps", bundledStampsDir: "/unused/bundled-stamps" },
    projectSession: { setSnapshotListener: () => {}, snapshot: () => ({ project: { originals, tasks }, activeTaskId }) },
    records: { reader: { read: vi.fn(), close: async () => {} }, session: "s1", openWindow: vi.fn() }
  } as unknown as RouterContext);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const reveal = (target: unknown, purpose?: "output") => electron.handlers.get("system.revealInFolder")!(target, purpose);

describe("revealing the output folder", () => {
  it("shows an existing folder by its absolute path", async () => {
    const folder = path.join(root, "output");
    fs.mkdirSync(folder);
    await reveal(path.join(folder, "..", "output"));
    expect(electron.showItemInFolder).toHaveBeenCalledExactlyOnceWith(folder);
  });

  it("resolves output expressions beside the active source, then the shared source parent", async () => {
    const sourceDir = path.join(root, "photos");
    const destination = path.join(sourceDir, "out");
    fs.mkdirSync(destination, { recursive: true });
    originals = [{ id: "a", sourcePath: path.join(sourceDir, "a.jpg") }, { id: "b", sourcePath: path.join(root, "elsewhere", "b.jpg") }];
    tasks = [{ id: "task-a", originalId: "a" }];
    activeTaskId = "task-a";
    await reveal(" out ", "output");
    expect(electron.showItemInFolder).toHaveBeenLastCalledWith(destination);
    activeTaskId = null;
    originals.pop();
    await reveal("out", "output");
    expect(electron.showItemInFolder).toHaveBeenLastCalledWith(destination);
  });

  it("expands Home and environment output expressions and preserves literal selected spaces", async () => {
    vi.stubEnv("HOME", root);
    vi.stubEnv("USERPROFILE", root);
    vi.stubEnv("FOTOREADY_REVEAL_TEST", root);
    const destination = path.join(root, "out");
    fs.mkdirSync(destination);
    for (const value of ["~/out", "$FOTOREADY_REVEAL_TEST/out"]) {
      await reveal(value, "output");
      expect(electron.showItemInFolder).toHaveBeenLastCalledWith(destination);
    }
    const literal = path.join(root, " $UNSET_REVEAL %literal% ");
    fs.mkdirSync(literal);
    await reveal(literal, "output");
    expect(electron.showItemInFolder).toHaveBeenLastCalledWith(literal);
  });

  it("rejects ambiguous relative output rather than using the launch folder", async () => {
    originals = [{ id: "a", sourcePath: path.join(root, "a/a.jpg") }, { id: "b", sourcePath: path.join(root, "b/b.jpg") }];
    await expect(reveal("out", "output")).rejects.toThrow("active photo or a shared source folder");
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });

  it("fails instead of doing nothing when the folder no longer exists", async () => {
    await expect(reveal(path.join(root, "gone"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });

  it("ignores an empty or non-text path", async () => {
    await reveal("");
    await reveal(42);
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });
});
