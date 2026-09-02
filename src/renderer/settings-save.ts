import type { GlobalSettings } from "@shared/types/settings";

/** Persist each independent settings substep and reconcile its draft immediately after commit. */
export async function persistSettingsChanges({
  apiKeyClearRequested,
  apiKeyDraft,
  clearApiKey,
  onApiKeyCleared,
  onApiKeyStored,
  onSettingsStored,
  settingsDirty,
  settingsDraft,
  setApiKey,
  updateSettings
}: {
  apiKeyClearRequested: boolean;
  apiKeyDraft: string;
  clearApiKey(): Promise<void>;
  onApiKeyCleared(): void;
  onApiKeyStored(): void;
  onSettingsStored(settings: GlobalSettings): void;
  settingsDirty: boolean;
  settingsDraft: GlobalSettings;
  setApiKey(apiKey: string): Promise<void>;
  updateSettings(settings: GlobalSettings): Promise<GlobalSettings>;
}): Promise<void> {
  if (apiKeyClearRequested) {
    await clearApiKey();
    onApiKeyCleared();
  } else if (apiKeyDraft.trim()) {
    await setApiKey(apiKeyDraft.trim());
    onApiKeyStored();
  }

  if (settingsDirty) {
    onSettingsStored(await updateSettings(settingsDraft));
  }
}
