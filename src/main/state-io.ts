import fs from "node:fs/promises";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";
import { utcStamp } from "@shared/time";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { AppLogger } from "./logger";

export async function loadState(statePath: string, logger?: AppLogger): Promise<UiState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const { state, issues } = normalizeUiState(JSON.parse(raw), defaultUiState());
    if (issues.length > 0) {
      const backupPath = await backupInvalidFile(statePath);
      logger?.warn("state file contained invalid data; using fallback values", { mod: "state", statePath, backupPath, issues });
      await saveState(statePath, state);
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const backupPath = await backupInvalidFile(statePath);
      logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, backupPath, err: error });
    }
    const state = defaultUiState();
    await saveState(statePath, state);
    return state;
  }
}

export async function saveState(statePath: string, state: UiState): Promise<void> {
  const normalized = normalizeUiState(state, defaultUiState()).state;
  await atomicWriteFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
}

async function backupInvalidFile(filePath: string): Promise<string | null> {
  const backupPath = `${filePath}.${utcStamp()}.invalid`;
  try {
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}
