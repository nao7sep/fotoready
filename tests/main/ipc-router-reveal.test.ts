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

beforeEach(() => {
  vi.clearAllMocks();
  electron.handlers.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-reveal-"));
  registerIpcHandlers({
    logger,
    settings: { lutFolder: "", stampFolder: "" },
    paths: { lutsDir: "/unused/luts", bundledLutsDir: "/unused/bundled-luts", stampsDir: "/unused/stamps", bundledStampsDir: "/unused/bundled-stamps" },
    projectSession: { setSnapshotListener: () => {}, snapshot: () => ({ project: { originals: [], tasks: [] } }) },
    records: { reader: { read: vi.fn(), close: async () => {} }, session: "s1", openWindow: vi.fn() }
  } as unknown as RouterContext);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const reveal = (target: unknown) => electron.handlers.get("system.revealInFolder")!(target);

describe("revealing the output folder", () => {
  it("shows an existing folder by its absolute path", async () => {
    const folder = path.join(root, "output");
    fs.mkdirSync(folder);
    await reveal(path.join(folder, "..", "output"));
    expect(electron.showItemInFolder).toHaveBeenCalledExactlyOnceWith(folder);
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
