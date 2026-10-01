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
  resetKeys,
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
  resetKeys: (keyof GlobalSettings)[];
  settingsDraft: GlobalSettings;
  setApiKey(apiKey: string): Promise<void>;
  updateSettings(patch: Partial<GlobalSettings>, resetKeys: (keyof GlobalSettings)[]): Promise<GlobalSettings>;
}): Promise<void> {
  if (apiKeyClearRequested) {
    await clearApiKey();
    onApiKeyCleared();
  } else if (apiKeyDraft.trim()) {
    await setApiKey(apiKeyDraft.trim());
    onApiKeyStored();
  }

  const patch = changedSettings(settings, settingsDraft, resetKeys);
  if (Object.keys(patch).length || resetKeys.length) {
    onSettingsStored(await updateSettings(patch, resetKeys));
  }
}

export function changedSettings(
  effective: GlobalSettings,
  draft: GlobalSettings,
  resetKeys: (keyof GlobalSettings)[] = []
): Partial<GlobalSettings> {
  return Object.fromEntries(SETTINGS_KEYS
    .filter((key) => !resetKeys.includes(key) && JSON.stringify(draft[key]) !== JSON.stringify(effective[key]))
    .map((key) => [key, draft[key]])) as Partial<GlobalSettings>;
}
