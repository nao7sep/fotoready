import fs from "node:fs/promises";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState } from "@shared/validation/state";
import { writeManagedFile } from "./write-managed-file";
import type { AppLogger } from "./logger";

type StateClassification =
  | { kind: "ok"; state: UiState }
  | { kind: "shape-invalid"; state: UiState; issues: string[] }
  | { kind: "absent" }
  | { kind: "unreadable"; error: unknown };

export async function loadState(statePath: string, logger?: AppLogger): Promise<UiState> {
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
    return classified.state;
  }

  if (classified.kind === "absent") {
    // Missing state is the normal first-run case: return defaults WITHOUT writing. state.json is
    // volatile UI state and is deliberately not materialized on first run (storage-path
    // conventions) — it is written only once there is real state to record (a resize, a selection).
    return defaultUiState();
  }

  // Nothing in this file has recovery value; log the invalid state and reset it.
  const state = classified.kind === "shape-invalid" ? classified.state : defaultUiState();
  if (classified.kind === "shape-invalid") {
    logger?.warn("state file contained invalid data; using fallback values", { mod: "state", statePath, issues: classified.issues });
  } else {
    logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, err: classified.error });
  }
  await saveState(statePath, state);
  return state;
}

export async function saveState(statePath: string, state: UiState): Promise<void> {
  const normalized = normalizeUiState(state, defaultUiState()).state;
  // recorded: state.json is durable managed text — window geometry, recent list, last selection. It is
  // recorded on every save DELIBERATELY (data-backup conventions): dedup absorbs the churn, and capturing
  // it is what quietly protects the durable registries that live in it. This is NOT the old
  // exclude-volatile rule; state.json goes through the managed-text choke point like config.json.
  await writeManagedFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
}
