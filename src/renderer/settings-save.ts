import { SETTINGS_KEYS } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";

/** Persist each independent settings substep and reconcile its draft immediately after commit. */
export async function persistSettingsChanges({
  apiKeyClearRequested,
  apiKeyDraft,
  clearApiKey,
  onApiKeyCleared,
  onApiKeyStored,
  onSettingsStored,
  settings,
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
  settings: GlobalSettings;
  settingsDraft: GlobalSettings;
  setApiKey(apiKey: string): Promise<void>;
  updateSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings>;
}): Promise<void> {
  if (apiKeyClearRequested) {
    await clearApiKey();
    onApiKeyCleared();
  } else if (apiKeyDraft.trim()) {
    await setApiKey(apiKeyDraft.trim());
    onApiKeyStored();
  }

  const patch = changedSettings(settings, settingsDraft);
  if (Object.keys(patch).length) {
    onSettingsStored(await updateSettings(patch));
  }
}

export function changedSettings(effective: GlobalSettings, draft: GlobalSettings): Partial<GlobalSettings> {
  return Object.fromEntries(SETTINGS_KEYS
    .filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(effective[key]))
    .map((key) => [key, draft[key]])) as Partial<GlobalSettings>;
}
