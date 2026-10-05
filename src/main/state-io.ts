import fs from "node:fs/promises";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState, type UiStateNormalizationResult } from "@shared/validation/state";
import { FORMAT_VERSIONS, parseVersionedJson, versionedJson, type VersionedJsonRead } from "@shared/format-versions";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { AppLogger } from "./logger";

export type LoadedState = {
  state: UiState;
  /** False when a newer build wrote the file, which is then left exactly as it is for the session. */
  writable: boolean;
};

export async function loadState(statePath: string, logger?: AppLogger): Promise<LoadedState> {
  let read: VersionedJsonRead;
  try {
    read = parseVersionedJson(await fs.readFile(statePath, "utf8"), FORMAT_VERSIONS.state);
  } catch (error) {
    // Missing state is the normal first-run case: return defaults WITHOUT writing. state.json is
    // volatile UI state and is deliberately not materialized on first run (storage-path
    // conventions) — it is written only once there is real state to record (a pane adjustment, a
    // histogram move).
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: defaultUiState(), writable: true };
    read = { kind: "invalid", error };
  }

  if (read.kind === "newer") {
    logger?.warn("state file was written by a newer FotoReady; using defaults and leaving it as it is", {
      mod: "state", statePath, formatVersion: read.found
    });
    return { state: defaultUiState(), writable: false };
  }

  if (read.kind === "current") {
    const { state, issues } = normalizeUiState(read.body, defaultUiState());
    if (issues.length === 0) return { state, writable: true };
    // Nothing in this file has recovery value; log the invalid state and reset it.
    logger?.warn("state file contained invalid data; using fallback values", { mod: "state", statePath, issues });
    await saveState(statePath, state);
    return { state, writable: true };
  }

  logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, err: read.error });
  const state = defaultUiState();
  await saveState(statePath, state);
  return { state, writable: true };
}

export async function saveState(statePath: string, state: UiState): Promise<void> {
  const normalized = normalizeUiState(state, defaultUiState()).state;
  // not recorded: state.json is volatile UI state and nothing else (pane widths, histogram placement),
  // so it stays out of the backup history; the write is still atomic.
  await atomicWriteFile(statePath, versionedJson(FORMAT_VERSIONS.state, normalized));
}

export type StateCoordinator = {
  update(patch: Partial<UiState>): Promise<UiStateNormalizationResult>;
  flush(): Promise<void>;
};

/**
 * One ordering boundary for renderer state updates and final shutdown. `loaded.state` is the live
 * state each update changes; a state that is not writable changes in memory only.
 */
export function createStateCoordinator(
  statePath: string,
  loaded: LoadedState,
  writer: (path: string, state: UiState) => Promise<void> = saveState
): StateCoordinator {
  const currentState = loaded.state;
  let tail: Promise<void> = Promise.resolve();
  const update = (patch: Partial<UiState>): Promise<UiStateNormalizationResult> => {
    const operation = tail.then(async () => {
      const candidate = { ...currentState, ...patch };
      const result = normalizeUiState(candidate, currentState);
      if (loaded.writable) await writer(statePath, result.state);
      Object.assign(currentState, result.state);
      return result;
    });
    tail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  };
  return { update, flush: async () => tail };
}
