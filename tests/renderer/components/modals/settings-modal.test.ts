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

describe("AppSettingsModal Gemini section", () => {
  it("lays out the section in order, with free-typed model fields and no list", async () => {
    await renderSettings({ initialTab: "vision", hasGeminiApiKey: true });
    const sections = [...document.querySelectorAll(".settings-page section")];
    expect(sections[0]?.querySelector("h3")?.textContent).toBe("Gemini");
    expect(sections[0]?.querySelector(":scope > .field-help")?.textContent).toBe("Gemini is the only provider supported.");
    const fields = [...sections[0]!.querySelectorAll(".stacked-field")].map((field) => field.firstChild?.textContent);
    expect(fields).toEqual(["Endpoint", "API key", "Description model", "Slug model"]);
    expect(fieldOf("Endpoint").input.value).toBe(defaultGlobalSettings()["gemini.endpoint"]);
    expect(fieldOf("Endpoint").help).toContain("The address FotoReady sends Gemini requests to.");
    expect(fieldOf("Description model").input.value).toBe("gemini-3.8-flash");
    expect(fieldOf("Description model").help).toContain("Writes the one-sentence description of each photo.");
    expect(fieldOf("Slug model").help).toContain("Suggests file names from the description.");
    expect(sections[1]?.querySelector("h3")).toBeNull();
    expect(sections[1]?.querySelector(".stacked-field")?.textContent).toContain("Vision image long edge");
    expect(sections[2]?.querySelector("h3")?.textContent).toBe("Prompts");
    expect(document.querySelectorAll(".settings-page select")).toHaveLength(0);
    expect(button("Refresh models")).toBeUndefined();
    expect(document.querySelector(".field-warning")).toBeNull();
  });

  it("warns under an id with no supported row, and matches a row trimmed and case-insensitively", async () => {
    await renderSettings({ initialTab: "vision", settings: { ...defaultGlobalSettings(), "gemini.description": " GEMINI-3.8-FLASH ", "gemini.slug": "typed-unknown" } });
    expect(fieldOf("Description model").warning).toBeNull();
    expect(fieldOf("Slug model").warning).toBe("Not a supported model. It may not work as expected.");
  });

  it("lets a user type an unknown role id into the draft without replacing any other role", async () => {
    const setSettingsDraft = vi.fn();
    await renderSettings({ initialTab: "vision", setSettingsDraft });
    const input = fieldOf("Description model").input;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "typed-any-model");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(setSettingsDraft).toHaveBeenCalledWith(expect.objectContaining({ "gemini.description": "typed-any-model", "gemini.slug": "gemini-3.5-flash-lite" }));
  });

  it("disables Save for an empty role id or an invalid endpoint, not for an unsupported id", async () => {
    await renderSettings({ initialTab: "vision", settings: { ...defaultGlobalSettings(), "gemini.slug": "" } });
    expect(document.querySelector<HTMLButtonElement>("button.primary-action")?.disabled).toBe(true);
    await renderSettings({ initialTab: "vision", settings: { ...defaultGlobalSettings(), "gemini.endpoint": "not a url" } });
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

describe("AppSettingsModal prompt reset", () => {
  it("fills the draft with the built-in prompt and stores nothing; Cancel then discards it", async () => {
    const setSettingsDraft = vi.fn();
    const onSaveSettings = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const settings = { ...defaultGlobalSettings(), visionDescriptionPrompt: "custom" };
    await renderSettings({ initialTab: "vision", onSaveSettings, onClose, settings, setSettingsDraft });

    expect(button("Reset slug prompt")?.disabled).toBe(true);
    await clickButton("Reset description prompt");
    expect(setSettingsDraft).toHaveBeenCalledExactlyOnceWith({ ...settings, visionDescriptionPrompt: defaultGlobalSettings().visionDescriptionPrompt });
    await clickButton("Cancel");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSaveSettings).not.toHaveBeenCalled();
  });
});

async function renderSettings({
  initialTab = "save",
  hasGeminiApiKey = false,
  onSaveSettings = vi.fn(async () => undefined),
  onClose = () => undefined,
  settings = defaultGlobalSettings(),
  setSettingsDraft = vi.fn()
}: {
  initialTab?: "save" | "app" | "vision";
  hasGeminiApiKey?: boolean;
  onSaveSettings?: () => Promise<void>;
  onClose?: () => void;
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
      onClose,
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

function fieldOf(label: string): { input: HTMLInputElement; help: string; warning: string | null } {
  const field = [...document.querySelectorAll(".settings-page .stacked-field")].find((candidate) => candidate.firstChild?.textContent === label)!;
  return {
    input: field.querySelector("input")!,
    help: [...field.querySelectorAll(".field-help")].map((help) => help.textContent).join(" "),
    warning: field.querySelector(".field-warning")?.textContent ?? null
  };
}
