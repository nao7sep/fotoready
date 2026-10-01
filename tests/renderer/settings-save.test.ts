import { describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { changedSettings, persistSettingsChanges } from "@renderer/settings-save";

describe("persistSettingsChanges", () => {
  it("reconciles a stored key before a later settings write rejects", async () => {
    const onApiKeyStored = vi.fn();
    const onSettingsStored = vi.fn();
    await expect(persistSettingsChanges({
      apiKeyClearRequested: false,
      apiKeyDraft: " new-key ",
      clearApiKey: vi.fn(),
      onApiKeyCleared: vi.fn(),
      onApiKeyStored,
      onSettingsStored,
      settings: defaultGlobalSettings(),
      resetKeys: [],
      settingsDraft: { ...defaultGlobalSettings(), defaultWebpQuality: 71 },
      setApiKey: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => { throw new Error("settings write failed"); })
    })).rejects.toThrow("settings write failed");

    expect(onApiKeyStored).toHaveBeenCalledOnce();
    expect(onSettingsStored).not.toHaveBeenCalled();
  });

  it("reconciles a cleared key before a later settings write rejects", async () => {
    const onApiKeyCleared = vi.fn();
    await expect(persistSettingsChanges({
      apiKeyClearRequested: true,
      apiKeyDraft: "",
      clearApiKey: vi.fn(async () => undefined),
      onApiKeyCleared,
      onApiKeyStored: vi.fn(),
      onSettingsStored: vi.fn(),
      settings: defaultGlobalSettings(),
      resetKeys: [],
      settingsDraft: { ...defaultGlobalSettings(), defaultWebpQuality: 71 },
      setApiKey: vi.fn(),
      updateSettings: vi.fn(async () => { throw new Error("settings write failed"); })
    })).rejects.toThrow("settings write failed");

    expect(onApiKeyCleared).toHaveBeenCalledOnce();
  });

  it("does not reconcile a substep that rejects before commit", async () => {
    const onApiKeyStored = vi.fn();
    await expect(persistSettingsChanges({
      apiKeyClearRequested: false,
      apiKeyDraft: "new-key",
      clearApiKey: vi.fn(),
      onApiKeyCleared: vi.fn(),
      onApiKeyStored,
      onSettingsStored: vi.fn(),
      settings: defaultGlobalSettings(),
      resetKeys: [],
      settingsDraft: defaultGlobalSettings(),
      setApiKey: vi.fn(async () => { throw new Error("key write failed"); }),
      updateSettings: vi.fn()
    })).rejects.toThrow("key write failed");

    expect(onApiKeyStored).not.toHaveBeenCalled();
  });
});

describe("changedSettings", () => {
  it("sends only changed sets, keeping the edited metadata set whole", () => {
    const settings = { ...defaultGlobalSettings(), injectFields: { author: "Jane", credit: "Me" } };
    const draft = { ...settings, defaultOutputFormat: "webp" as const, injectFields: { author: "Jane", credit: "You" } };
    expect(changedSettings(settings, draft)).toEqual({ defaultOutputFormat: "webp", injectFields: draft.injectFields });
  });

  it("omits reset sets from the patch even when the built-in differs from the saved prompt", () => {
    const settings = { ...defaultGlobalSettings(), visionDescriptionPrompt: "custom" };
    expect(changedSettings(settings, defaultGlobalSettings(), ["visionDescriptionPrompt"])).toEqual({});
  });
});

it("sends a reset deletion even when the effective prompt already equals the built-in", async () => {
  const updateSettings = vi.fn(async () => defaultGlobalSettings());
  await persistSettingsChanges({
    apiKeyClearRequested: false,
    apiKeyDraft: "",
    clearApiKey: vi.fn(),
    onApiKeyCleared: vi.fn(),
    onApiKeyStored: vi.fn(),
    onSettingsStored: vi.fn(),
    settings: defaultGlobalSettings(),
    resetKeys: ["visionSlugPrompt"],
    settingsDraft: defaultGlobalSettings(),
    setApiKey: vi.fn(),
    updateSettings
  });
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({}, ["visionSlugPrompt"]);
});
