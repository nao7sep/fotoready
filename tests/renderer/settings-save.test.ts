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
      settingsDirty: true,
      settingsDraft: defaultGlobalSettings(),
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
      settingsDirty: true,
      settingsDraft: defaultGlobalSettings(),
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
      settingsDirty: false,
      settingsDraft: defaultGlobalSettings(),
      setApiKey: vi.fn(async () => { throw new Error("key write failed"); }),
      updateSettings: vi.fn()
    })).rejects.toThrow("key write failed");

    expect(onApiKeyStored).not.toHaveBeenCalled();
  });
});
