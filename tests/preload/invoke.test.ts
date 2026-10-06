import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FotoReadyApi } from "@shared/types/ipc";
import { message } from "@shared/i18n/translate";
import { ipcFailure } from "@shared/ipc-failure";

// Electron's contextBridge drops an Error's own fields, so the preload rethrows a main-authored
// IpcFailure as the plain object itself and passes every other result through.

const bridge = vi.hoisted(() => ({ api: null as unknown, invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { bridge.api = api; } },
  ipcRenderer: { invoke: bridge.invoke, on: vi.fn(), off: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}));

await import("../../src/preload/index");
const api = bridge.api as FotoReadyApi;

beforeEach(() => {
  bridge.invoke.mockReset();
});

describe("preload requests", () => {
  it("reject with the IpcFailure itself, reason intact", async () => {
    const failure = ipcFailure(message("failure.pathVariable", { variable: "PHOTOS" }));
    bridge.invoke.mockResolvedValue(failure);
    await expect(api.luts.list()).rejects.toBe(failure);
    expect(bridge.invoke).toHaveBeenCalledWith("luts.list");
  });

  it("resolve with any other result unchanged", async () => {
    const entries = [{ name: "warm.cube", path: "/luts/warm.cube", builtin: false }];
    bridge.invoke.mockResolvedValue(entries);
    await expect(api.luts.list()).resolves.toBe(entries);
  });
});
