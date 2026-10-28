import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import type { IpcWork, RouterContext } from "@main/ipc-router";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  saveSettings: vi.fn()
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { mocks.handlers.set(channel, async (...args) => handler({}, ...args)); } },
  BrowserWindow: { getAllWindows: () => [] }, app: { isPackaged: false }, dialog: {}, shell: {},
  nativeTheme: { on: () => {}, themeSource: "system", shouldUseDarkColors: false }, screen: {}
}));
vi.mock("@main/settings-io", () => ({ saveSettings: mocks.saveSettings }));
vi.mock("@main/i18n", () => ({ changeLanguagePreference: async () => false, interfaceLanguage: () => ({ language: "en", locale: "en" }), mainTranslator: () => () => "" }));
import { registerIpcHandlers } from "@main/ipc-router";

let settings: GlobalSettings;
let ipcWork: IpcWork;
beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear();
  settings = defaultGlobalSettings();
  mocks.saveSettings.mockImplementation(async (_file: unknown, draft: GlobalSettings) => draft);
  ipcWork = registerIpcHandlers({ settings,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    projectSession: { setSnapshotListener: () => {} }
  } as unknown as RouterContext);
});
const invoke = (channel: string, value?: unknown): Promise<unknown> => mocks.handlers.get(channel)!(value);

describe("authored settings retries through IPC", () => {
  it("reports a failed settings save until the quit's retry lands it", async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error("publication refused"));
    await expect(invoke("settings.update", { ...settings, defaultOutputFormat: "png" })).rejects.toThrow();
    const failed = ipcWork.unsavedSettings()!;
    expect(failed).toMatchObject({ work: { kind: "settings" }, running: false });

    failed.retry();
    await ipcWork.unsavedSettings()?.settled;
    expect(ipcWork.unsavedSettings()).toBeNull();
    expect(settings.defaultOutputFormat).toBe("png");
  });

  it("does not replay an older failed settings submission over a newer save", async () => {
    let fail!: () => void;
    const failure = new Error("publication refused");
    let started!: () => void;
    const writeStarted = new Promise<void>((resolve) => { started = resolve; });
    mocks.saveSettings.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(failure); started(); }));
    const first = invoke("settings.update", { ...settings, defaultOutputFormat: "png" });
    const rejected = expect(first).rejects.toBe(failure);
    const failedWrite = ipcWork.unsavedSettings()!;
    await writeStarted;
    const second = invoke("settings.update", { ...settings, defaultOutputFormat: "webp" });
    fail();
    await rejected; await second;
    expect(ipcWork.unsavedSettings()).toBeNull();

    failedWrite.retry();
    await ipcWork.unsavedSettings()?.settled;
    expect(mocks.saveSettings).toHaveBeenCalledTimes(2);
    expect(settings.defaultOutputFormat).toBe("webp");
  });
});
