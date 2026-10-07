import { expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";

const owned = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  importStamps: vi.fn(), deleteStamps: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => owned.handlers.set(channel, async (...args) => handler({}, ...args)) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { isPackaged: false }, shell: {}, dialog: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }, screen: {},
}));
vi.mock("@main/stamp-catalog", async (load) => ({ ...await load<typeof import("@main/stamp-catalog")>(), importStamps: owned.importStamps, deleteStamps: owned.deleteStamps }));
const { registerIpcHandlers } = await import("@main/ipc-router");

it("orders admitted asset mutations and releases the lane after import failure", async () => {
  let fail!: (error: unknown) => void;
  owned.importStamps.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  registerIpcHandlers({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: { stampFolder: "" }, paths: { stampsDir: "/stamps", bundledStampsDir: "/bundled" },
    projectSession: { setSnapshotListener: () => {} },
  } as unknown as RouterContext);
  const first = owned.handlers.get("stamps.import")!(["/new.png"]);
  const failure = new Error("import failed");
  const refused = expect(first).rejects.toBe(failure);
  const second = owned.handlers.get("stamps.delete")!(["/old.png"]);
  await Promise.resolve();
  expect(owned.importStamps).toHaveBeenCalledOnce();
  expect(owned.deleteStamps).not.toHaveBeenCalled();
  fail(failure);
  await refused;
  await second;
  expect(owned.deleteStamps).toHaveBeenCalledWith(["/old.png"], "", "/stamps");
});
