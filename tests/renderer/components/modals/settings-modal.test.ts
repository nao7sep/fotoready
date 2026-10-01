// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { AppSettingsModal } from "@renderer/components/modals/settings-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const log = vi.fn(async () => undefined);
const models = vi.fn<(request: { endpoint: string; force?: boolean }) => Promise<string[]>>();
const pickDirectory = vi.fn<() => Promise<string | null>>();
const hostile = new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_SETTINGS_SENTINEL");

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  log.mockClear();
  pickDirectory.mockReset();
  models.mockReset();
  models.mockResolvedValue(["gemini-3.99-future"]);
  vi.stubGlobal("api", { system: { log, pickDirectory }, settings: { models } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("AppSettingsModal theme", () => {
  it("offers System, Light, and Dark as one radio group that changes only the draft", async () => {
    const setSettingsDraft = vi.fn();
    const onSaveSettings = vi.fn(async () => undefined);
    await renderSettings({ initialTab: "app", onSaveSettings, setSettingsDraft });

    const group = [...document.querySelectorAll("fieldset")].find((fieldset) => fieldset.querySelector("legend")?.textContent === "Theme");
    const radios = [...(group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios.find((radio) => radio.checked)?.value).toBe("system");

    await act(async () => radios[2]!.click());
    expect(setSettingsDraft).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
    expect(onSaveSettings).not.toHaveBeenCalled();
  });
});

describe("AppSettingsModal UI font", () => {
  it("shows the built-in default as the field's placeholder, not a stored value", async () => {
    await renderSettings({ initialTab: "app" });

    const input = [...document.querySelectorAll<HTMLInputElement>('input[type="text"]')]
      .find((candidate) => candidate.placeholder === "Blank = default system font");
    expect(input).not.toBeUndefined();
    expect(input?.value).toBe("");
  });
});

describe("AppSettingsModal open role models", () => {
  it("offers role suggestions, fetched ids, extras, and an unchanged out-of-list selection", async () => {
    const settings = { ...defaultGlobalSettings(), "gemini.description": "old-typed-id", extraModelIds: { gemini: ["custom-extra"] } };
    await renderSettings({ initialTab: "vision", settings, hasGeminiApiKey: true });
    const description = [...document.querySelectorAll<HTMLSelectElement>("select")].find((select) => select.getAttribute("aria-label") === "Description model")!;
    expect(description.value).toBe("old-typed-id");
    expect([...description.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Suggested models", "Provider models", "Extra model IDs (one per line)"]);
    expect([...description.options].map((option) => option.value)).toEqual(["gemini-3.8-flash", "gemini-3.99-future", "custom-extra", "old-typed-id"]);
    expect(description.selectedOptions[0]?.textContent).toBe("old-typed-id (out of list)");
    const slug = document.querySelector<HTMLSelectElement>('select[aria-label="Slug model"]')!;
    expect(slug.querySelector("optgroup")?.textContent).toBe("gemini-3.5-flash-lite");
    expect(models).toHaveBeenCalledOnce();
    expect(models).toHaveBeenCalledWith({ endpoint: settings["gemini.endpoint"], force: false, useStoredKey: true });
  });

  it("lets a user type an unknown role id into the draft without replacing any other role", async () => {
    const setSettingsDraft = vi.fn();
    await renderSettings({ initialTab: "vision", setSettingsDraft });
    const label = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent === "Description model")!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "typed-any-model");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(setSettingsDraft).toHaveBeenCalledWith(expect.objectContaining({ "gemini.description": "typed-any-model", "gemini.slug": "gemini-3.5-flash-lite" }));
  });

  it("refreshes only on open or an explicit Refresh", async () => {
    const settings = defaultGlobalSettings();
    await renderSettings({ initialTab: "vision", settings, hasGeminiApiKey: true });
    await renderSettings({ initialTab: "vision", settings: { ...settings, visionConcurrency: 4 }, hasGeminiApiKey: true });
    expect(models).toHaveBeenCalledOnce();
    await clickButton("Refresh models");
    expect(models).toHaveBeenCalledTimes(2);
    expect(models).toHaveBeenLastCalledWith({ endpoint: settings["gemini.endpoint"], force: true, useStoredKey: true });
  });

  it("disables Save for an empty role id without validating against a provider list", async () => {
    await renderSettings({ initialTab: "vision", settings: { ...defaultGlobalSettings(), "gemini.slug": "" } });
    expect(document.querySelector<HTMLButtonElement>("button.primary-action")?.disabled).toBe(true);
    await renderSettings({ initialTab: "vision", settings: { ...defaultGlobalSettings(), "gemini.slug": "unknown-allowed" } });
    expect(document.querySelector<HTMLButtonElement>("button.primary-action")?.disabled).toBe(false);
  });
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
  initialTab = "save",
  hasGeminiApiKey = false,
  onSaveSettings = vi.fn(async () => undefined),
  settings = defaultGlobalSettings(),
  setSettingsDraft = vi.fn()
}: {
  initialTab?: "save" | "app" | "vision";
  hasGeminiApiKey?: boolean;
  onSaveSettings?: () => Promise<void>;
  settings?: ReturnType<typeof defaultGlobalSettings>;
  setSettingsDraft?: (settings: ReturnType<typeof defaultGlobalSettings>) => void;
} = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(AppSettingsModal, {
      apiKeyClearRequested: false,
      apiKeyDraft: "",
      hasChanges: true,
      hasGeminiApiKey,
      initialTab,
      onApiKeyDraftChange: () => undefined,
      onClearApiKey: () => undefined,
      onKeepApiKey: () => undefined,
      onClose: () => undefined,
      onSaveSettings,
      onResetPrompt: vi.fn(),
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
