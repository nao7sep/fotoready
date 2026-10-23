import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterContext } from "@main/ipc-router";
import type { LutEntry } from "@shared/types/ipc";

const owned = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  listLuts: vi.fn<() => Promise<LutEntry[]>>()
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => owned.handlers.set(channel, async (...args) => handler({}, ...args)) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  app: { isPackaged: false }, shell: {}, dialog: {}, screen: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }
}));
vi.mock("@main/lut-catalog", async (load) => ({ ...await load<typeof import("@main/lut-catalog")>(), listLuts: owned.listLuts }));
const { registerIpcHandlers } = await import("@main/ipc-router");

beforeEach(() => { owned.handlers.clear(); owned.listLuts.mockReset(); });

function arrange() {
  const renderLutPreviews = vi.fn(async () => []);
  const cancelLutPreview = vi.fn();
  registerIpcHandlers({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: { lutFolder: "" }, paths: { lutsDir: "/luts", bundledLutsDir: "/bundled" },
    projectSession: { setSnapshotListener: () => {}, renderLutPreviews, cancelLutPreview }
  } as unknown as RouterContext);
  return { renderLutPreviews, cancelLutPreview };
}

function deferredList() {
  let resolve!: (entries: LutEntry[]) => void;
  const promise = new Promise<LutEntry[]>((done) => { resolve = done; });
  return { promise, resolve };
}
const call = (channel: string, ...args: unknown[]) => owned.handlers.get(channel)!(...args);
const entries: LutEntry[] = [{ path: "/luts/warm.cube", name: "warm.cube", builtin: false }];

describe("LUT preview listing lifetime", () => {
  it("does not start a batch when the picker closes while the library list is pending", async () => {
    const pendingList = deferredList();
    owned.listLuts.mockReturnValueOnce(pendingList.promise);
    const { renderLutPreviews, cancelLutPreview } = arrange();
    const preview = call("luts.preview", "task", undefined, 1, 160);
    expect(cancelLutPreview).toHaveBeenCalledOnce();
    await call("luts.cancelPreview");
    pendingList.resolve(entries);
    expect(await preview).toBeNull();
    expect(renderLutPreviews).not.toHaveBeenCalled();
    expect(cancelLutPreview).toHaveBeenCalledTimes(2);
  });

  it("runs only the latest request when an older library list settles later", async () => {
    const oldList = deferredList();
    const newList = deferredList();
    owned.listLuts.mockReturnValueOnce(oldList.promise).mockReturnValueOnce(newList.promise);
    const { renderLutPreviews, cancelLutPreview } = arrange();
    const old = call("luts.preview", "old-task", undefined, 0.2, 160);
    const fresh = call("luts.preview", "new-task", undefined, 0.8, 160);
    expect(cancelLutPreview).toHaveBeenCalledTimes(2);
    newList.resolve(entries);
    expect(await fresh).toEqual([]);
    oldList.resolve(entries);
    expect(await old).toBeNull();
    expect(renderLutPreviews).toHaveBeenCalledOnce();
    expect(renderLutPreviews).toHaveBeenCalledWith("new-task", entries, undefined, 0.8, 160);
  });
});
