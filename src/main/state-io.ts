import fs from "node:fs/promises";
import path from "node:path";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";
import { utcStamp } from "@shared/time";
import { writeManagedFile } from "./write-managed-file";
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
  // recorded: state.json is durable managed text — window geometry, recent list, last selection. It is
  // recorded on every save DELIBERATELY (data-backup conventions): dedup absorbs the churn, and capturing
  // it is what quietly protects the durable registries that live in it. This is NOT the old
  // exclude-volatile rule; state.json goes through the managed-text choke point like config.json.
  await writeManagedFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
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
