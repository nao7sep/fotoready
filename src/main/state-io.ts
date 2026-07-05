import fs from "node:fs/promises";
import path from "node:path";
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Missing state is the normal first-run case: return defaults WITHOUT writing. state.json is
      // volatile UI state and is deliberately not materialized on first run (storage-path
      // conventions) — it is written only once there is real state to record (a resize, a selection).
      return defaultUiState();
    }
    // Present but unreadable: quarantine the bad bytes, then reset to defaults on disk so the next
    // launch does not re-read (and re-quarantine) the same corrupt file.
    const backupPath = await backupInvalidFile(statePath);
    logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, backupPath, err: error });
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
  // <stem>-<timestamp>.invalid, alongside the source file (derived-filename grammar).
  const backupPath = path.join(path.dirname(filePath), `${path.parse(filePath).name}-${utcStamp()}.invalid`);
  try {
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}
