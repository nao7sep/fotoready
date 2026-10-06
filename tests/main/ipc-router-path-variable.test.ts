import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";
import { message } from "@shared/i18n/translate";
import { ipcFailure } from "@shared/ipc-failure";

// A configured path naming an unset variable goes back to the renderer as an IpcFailure
// carrying the reason, through the real IPC chokepoint with Electron's glue stubbed.

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
  handlers.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("FOTOREADY_IPC_TEST_UNSET", undefined);
  registerIpcHandlers({
    logger,
    settings: { lutFolder: "$FOTOREADY_IPC_TEST_UNSET/luts", stampFolder: "%FOTOREADY_IPC_TEST_UNSET%/stamps" },
    paths: { lutsDir: "/unused/luts", bundledLutsDir: "/unused/bundled-luts", stampsDir: "/unused/stamps", bundledStampsDir: "/unused/bundled-stamps" },
    projectSession: { setSnapshotListener: () => {}, snapshot: () => ({ project: { originals: [], tasks: [] } }) },
    records: { reader: { read: vi.fn(), close: async () => {} }, session: "s1", openWindow: vi.fn() }
  } as unknown as RouterContext);
});

describe("a configured path naming an unset variable", () => {
  it.each(["luts.list", "stamps.list"])("makes %s resolve with the reason naming the variable, and logs the failure", async (channel) => {
    await expect(handlers.get(channel)!()).resolves.toEqual(
      ipcFailure(message("failure.pathVariable", { variable: "FOTOREADY_IPC_TEST_UNSET" }))
    );
    expect(logger.error).toHaveBeenCalledWith(`ipc ${channel} failed`, expect.objectContaining({ channel }));
  });
});
