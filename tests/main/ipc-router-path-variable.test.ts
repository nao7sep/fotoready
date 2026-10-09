import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";
import { message } from "@shared/i18n/translate";
import { StoreNotWritableError } from "@adapters/json-store";
import { ipcFailure } from "@shared/ipc-failure";

// A configured path naming an unset variable, or a library folder that cannot be read, goes back
// to the renderer as an IpcFailure carrying the reason, through the real IPC chokepoint with
// Electron's glue stubbed.

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

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("FOTOREADY_IPC_TEST_UNSET", undefined);
  register({ lutFolder: "$FOTOREADY_IPC_TEST_UNSET/luts", stampFolder: "%FOTOREADY_IPC_TEST_UNSET%/stamps" });
});

function register(settings: { lutFolder: string; stampFolder: string }): void {
  handlers.clear();
  registerIpcHandlers({
    logger,
    settings,
    paths: { lutsDir: "/unused/luts", bundledLutsDir: "/unused/bundled-luts", stampsDir: "/unused/stamps", bundledStampsDir: "/unused/bundled-stamps" },
    projectSession: { setSnapshotListener: () => {}, snapshot: () => ({ project: { originals: [], tasks: [] } }) },
    records: { reader: { read: vi.fn(), close: async () => {} }, session: "s1", openWindow: vi.fn() }
  } as unknown as RouterContext);
}

describe("a configured path naming an unset variable", () => {
  it.each(["luts.list", "stamps.list"])("makes %s resolve with the reason naming the variable, and logs the failure", async (channel) => {
    await expect(handlers.get(channel)!()).resolves.toEqual(
      ipcFailure(message("failure.pathVariable", { variable: "FOTOREADY_IPC_TEST_UNSET" }))
    );
    expect(logger.error).toHaveBeenCalledWith(`ipc ${channel} failed`, expect.objectContaining({ channel }));
  });
});

describe("a library folder that cannot be read", () => {
  it.each(["luts.list", "stamps.list"])("makes %s resolve with the reason naming the folder", async (channel) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-ipc-library-"));
    try {
      const notADirectory = path.join(root, "library");
      fs.writeFileSync(notADirectory, "not a directory");
      register({ lutFolder: notADirectory, stampFolder: notADirectory });

      await expect(handlers.get(channel)!()).resolves.toEqual(
        ipcFailure(message("failure.libraryFolderUnreadable", { path: notADirectory, reason: expect.any(String) }))
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("a store left as it is at load", () => {
  it("transmits the named file and why it is not written, without the diagnostic message", async () => {
    const refused = new StoreNotWritableError("/data/api-keys.json", "newer");
    handlers.clear();
    registerIpcHandlers({
      logger,
      settings: {},
      paths: {},
      userWork: { run: (_kind: unknown, work: () => Promise<unknown>) => work() },
      projectSession: { setSnapshotListener: () => {}, setGeminiApiKey: async () => { throw refused; } },
      records: { reader: { read: vi.fn(), close: async () => {} }, session: "s1", openWindow: vi.fn() }
    } as unknown as RouterContext);
    const result = await handlers.get("settings.setGeminiApiKey")!("new-key");
    expect(result).toEqual(ipcFailure(message("failure.storeLeftNewer", { path: "/data/api-keys.json" })));
    expect(JSON.stringify(result)).not.toContain("this session does not write it");
    expect(logger.error).toHaveBeenCalledWith("ipc settings.setGeminiApiKey failed", expect.objectContaining({ err: refused }));
  });
});
