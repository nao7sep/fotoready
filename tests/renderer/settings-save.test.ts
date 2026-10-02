import { describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { persistSettingsChanges } from "@renderer/settings-save";

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
      settingsDraft: defaultGlobalSettings(),
      setApiKey: vi.fn(async () => { throw new Error("key write failed"); }),
      updateSettings: vi.fn()
    })).rejects.toThrow("key write failed");

    expect(onApiKeyStored).not.toHaveBeenCalled();
  });
});

it("sends the whole draft, so the main process writes the file from every set it holds", async () => {
  const draft = { ...defaultGlobalSettings(), defaultOutputFormat: "webp" as const };
  const updateSettings = vi.fn(async () => draft);
  const onSettingsStored = vi.fn();
  await persistSettingsChanges({
    apiKeyClearRequested: false,
    apiKeyDraft: "",
    clearApiKey: vi.fn(),
    onApiKeyCleared: vi.fn(),
    onApiKeyStored: vi.fn(),
    onSettingsStored,
    settingsDraft: draft,
    setApiKey: vi.fn(),
    updateSettings
  });
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith(draft);
  expect(onSettingsStored).toHaveBeenCalledExactlyOnceWith(draft);
});
