import fs from "node:fs/promises";
import path from "node:path";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";

export async function loadState(statePath: string): Promise<UiState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const { state, issues } = normalizeUiState(JSON.parse(raw), defaultUiState());
    for (const issue of issues) {
      console.warn(`State file contained invalid data; using fallback value: ${issue}`);
    }
    if (issues.length > 0) {
      await saveState(statePath, state);
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`State file was unreadable; using defaults: ${(error as Error).message}`);
    }
    const state = defaultUiState();
    await saveState(statePath, state);
    return state;
  }
}

export async function saveState(statePath: string, state: UiState): Promise<void> {
  const normalized = normalizeUiState(state, defaultUiState()).state;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
