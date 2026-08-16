import fs from "node:fs/promises";
import path from "node:path";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";
import { utcStamp } from "@shared/time";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

export type StateLoadResult = {
  state: UiState;
  // Set when the on-disk file was corrupt and its bytes were copied aside —
  // the app edge reports it (storage-path conventions: both branches report).
  quarantinedTo: string | null;
};

// Two phases, for the reason spelled out in settings-io.ts: only the read and parse sit
// inside the try, and the quarantine copy runs outside it so a failed copy propagates
// rather than being reclassified as an unreadable file and resetting over bytes that were
// never preserved (storage-path conventions).
type StateClassification =
  | { kind: "ok"; state: UiState }
  | { kind: "shape-invalid"; state: UiState; issues: string[] }
  | { kind: "absent" }
  | { kind: "unreadable"; error: unknown };

export async function loadState(statePath: string, logger?: AppLogger): Promise<StateLoadResult> {
  let classified: StateClassification;
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const { state, issues } = normalizeUiState(JSON.parse(raw), defaultUiState());
    classified = issues.length > 0 ? { kind: "shape-invalid", state, issues } : { kind: "ok", state };
  } catch (error) {
    classified =
      (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", error };
  }

  if (classified.kind === "ok") {
    return { state: classified.state, quarantinedTo: null };
  }

  if (classified.kind === "absent") {
    // Missing state is the normal first-run case: return defaults WITHOUT writing. state.json is
    // volatile UI state and is deliberately not materialized on first run (storage-path
    // conventions) — it is written only once there is real state to record (a resize, a selection).
    return { state: defaultUiState(), quarantinedTo: null };
  }

  // Corrupt, either way. Preserve the bytes BEFORE the reset; a failure here propagates.
  const backupPath = await backupInvalidFile(statePath);
  const state = classified.kind === "shape-invalid" ? classified.state : defaultUiState();
  if (classified.kind === "shape-invalid") {
    logger?.warn("state file contained invalid data; using fallback values", { mod: "state", statePath, backupPath, issues: classified.issues });
  } else {
    logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, backupPath, err: classified.error });
  }
  await saveState(statePath, state);
  return { state, quarantinedTo: backupPath };
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
  // The copy either lands or its failure propagates — swallowing it would let
  // the caller reset over the very bytes the copy exists to preserve
  // (storage-path conventions).
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}
