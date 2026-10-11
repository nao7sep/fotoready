import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import type { RouterContext } from "@main/ipc-router";
import { UserWorkWrites } from "@main/quit-save";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  saveSettings: vi.fn(), setKey: vi.fn(), clearKey: vi.fn()
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { mocks.handlers.set(channel, async (...args) => handler({}, ...args)); } },
  BrowserWindow: { getAllWindows: () => [] }, app: { isPackaged: false }, dialog: {}, shell: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }, screen: {}
}));
vi.mock("@main/settings-io", () => ({ saveSettings: mocks.saveSettings }));
vi.mock("@main/i18n", () => ({ changeLanguagePreference: async () => false, interfaceLanguage: () => ({ language: "en", locale: "en" }), mainTranslator: () => () => "" }));
import { registerIpcHandlers } from "@main/ipc-router";

let writes: UserWorkWrites;
let settings: GlobalSettings;
beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear();
  writes = new UserWorkWrites(); settings = defaultGlobalSettings();
  mocks.saveSettings.mockImplementation(async (_file: unknown, draft: GlobalSettings) => draft);
  mocks.setKey.mockResolvedValue(undefined); mocks.clearKey.mockResolvedValue(undefined);
  registerIpcHandlers({ settings, userWork: writes,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    projectSession: { setSnapshotListener: () => {}, setGeminiApiKey: mocks.setKey, clearGeminiApiKey: mocks.clearKey }
  } as unknown as RouterContext);
});
const invoke = (channel: string, value?: unknown): Promise<unknown> => mocks.handlers.get(channel)!(value);

describe("authored settings and credential retries through IPC", () => {
  it.each(["settings", "key"])("does not replay an older failed %s submission over a newer save", async (kind) => {
    let fail!: () => void;
    const failure = new Error("publication refused");
    const channel = kind === "settings" ? "settings.update" : "settings.setGeminiApiKey";
    const save = kind === "settings" ? mocks.saveSettings : mocks.setKey;
    save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(failure); }));
    const firstValue = kind === "settings" ? { ...settings, defaultOutputFormat: "png" } : "first-key";
    const secondValue = kind === "settings" ? { ...settings, defaultOutputFormat: "webp" } : "second-key";
    const first = invoke(channel, firstValue);
    const rejected = expect(first).rejects.toBe(failure);
    await vi.waitFor(() => expect(fail).toBeDefined());
    const second = invoke(channel, secondValue);
    writes.beginQuit(); fail();
    await rejected; await second;
    writes.retry(); await writes.settle(1_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(writes.unsaved()).toEqual({ failed: [], running: [] });
    if (kind === "settings") expect(settings.defaultOutputFormat).toBe("webp");
    else expect(mocks.setKey).toHaveBeenLastCalledWith("second-key");
  });

  it("keeps a failed settings retry when an independent key is saved", async () => {
    writes.beginQuit();
    mocks.saveSettings.mockRejectedValueOnce(new Error("publication refused"));
    await expect(invoke("settings.update", { ...settings, defaultOutputFormat: "png" })).rejects.toThrow();
    await invoke("settings.setGeminiApiKey", "independent-key");
    expect(writes.unsaved().failed).toHaveLength(1);
    writes.retry(); await writes.settle(1_000);
    expect(settings.defaultOutputFormat).toBe("png");
    expect(mocks.setKey).toHaveBeenCalledOnce();
  });
});
