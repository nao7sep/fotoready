// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { AppSettingsModal } from "@renderer/components/modals/settings-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const log = vi.fn(async () => undefined);
const pickDirectory = vi.fn<() => Promise<string | null>>();
const hostile = new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_SETTINGS_SENTINEL");

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  log.mockClear();
  pickDirectory.mockReset();
  vi.stubGlobal("api", { system: { log, pickDirectory } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("AppSettingsModal failure ownership", () => {
  it("keeps a failed save inside the open modal with authored copy", async () => {
    await renderSettings({ onSaveSettings: vi.fn(async () => { throw hostile; }) });
    await clickButton("Save");

    const result = document.querySelector('[role="alert"]');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(result?.textContent).toContain("remaining changes stay open");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_SETTINGS_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: "settings save failed" }));
  });

  it("keeps the current path when its picker rejects", async () => {
    pickDirectory.mockRejectedValue(hostile);
    const settings = { ...defaultGlobalSettings(), defaultOutputDirectory: "/Users/example/current" };
    const setSettingsDraft = vi.fn();
    await renderSettings({ settings, setSettingsDraft });
    await clickButton("Choose folder");

    const result = document.querySelector('[role="alert"]');
    const path = document.querySelector<HTMLInputElement>('input[value="/Users/example/current"]');
    expect(path).not.toBeNull();
    expect(document.querySelector(`label[for="${path?.id}"]`)?.textContent).toBe("Folder");
    expect(result?.closest("label")).toBeNull();
    expect(setSettingsDraft).not.toHaveBeenCalled();
    expect(result?.textContent).toContain("The current path is unchanged");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_SETTINGS_SENTINEL|invoking remote method/i);

    pickDirectory.mockResolvedValue(null);
    await clickButton("Choose folder");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The current path is unchanged");
  });

  it("settles only one save while the first request is in flight", async () => {
    let resolveSave: (() => void) | undefined;
    const onSaveSettings = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    await renderSettings({ onSaveSettings });
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent === "Save")
      .at(-1)!;

    await act(async () => {
      save.click();
      save.click();
      await Promise.resolve();
    });

    expect(onSaveSettings).toHaveBeenCalledOnce();
    expect(button("Saving…")?.disabled).toBe(true);
    expect(button("Cancel")?.disabled).toBe(true);
    await act(async () => resolveSave?.());
  });
});

async function renderSettings({
  onSaveSettings = vi.fn(async () => undefined),
  settings = defaultGlobalSettings(),
  setSettingsDraft = vi.fn()
}: {
  onSaveSettings?: () => Promise<void>;
  settings?: ReturnType<typeof defaultGlobalSettings>;
  setSettingsDraft?: (settings: ReturnType<typeof defaultGlobalSettings>) => void;
} = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(AppSettingsModal, {
      apiKeyClearRequested: false,
      apiKeyDraft: "",
      hasChanges: true,
      hasGeminiApiKey: false,
      initialTab: "save",
      onApiKeyDraftChange: () => undefined,
      onClearApiKey: () => undefined,
      onKeepApiKey: () => undefined,
      onClose: () => undefined,
      onSaveSettings,
      settingsDraft: settings,
      setSettingsDraft,
      systemInfo: null
    }));
  });
}

async function clickButton(label: string): Promise<void> {
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent === label)
    .at(-1);
  expect(target).toBeDefined();
  await act(async () => target!.click());
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
}
