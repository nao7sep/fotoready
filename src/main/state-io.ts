import fs from "node:fs/promises";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState, type UiStateNormalizationResult } from "@shared/validation/state";
import { FORMAT_VERSIONS, parseVersionedJson, versionedJson, type VersionedJsonRead } from "@shared/format-versions";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { AppLogger } from "./logger";

export type LoadedState = {
  state: UiState;
  /**
   * Decided once at load: false when a newer build wrote the file or it could not be read or reset,
   * which leaves it exactly as it is for the session.
   */
  writable: boolean;
};

/**
 * `state.json` is disposable UI state (developer decision): what cannot be read is replaced by
 * defaults, in memory only when the file cannot be read or written, so it never stops startup.
 */
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
    logger?.warn("state file could not be read; using defaults and leaving it as it is for this session", { mod: "state", statePath, err: error });
    return { state: defaultUiState(), writable: false };
  }

  if (read.kind === "newer") {
    logger?.warn("state file was written by a newer FotoReady; using defaults and leaving it as it is", {
      mod: "state", statePath, formatVersion: read.found
    });
    return { state: defaultUiState(), writable: false };
  }

  let state: UiState;
  if (read.kind === "current") {
    const normalized = normalizeUiState(read.body, defaultUiState());
    if (normalized.issues.length === 0) return { state: normalized.state, writable: true };
    // Nothing in this file has recovery value; log the invalid state and reset it.
    logger?.warn("state file contained invalid data; using fallback values", { mod: "state", statePath, issues: normalized.issues });
    state = normalized.state;
  } else {
    logger?.warn("state file was unreadable; using defaults", { mod: "state", statePath, err: read.error });
    state = defaultUiState();
  }
  try {
    await saveState(statePath, state);
  } catch (error) {
    logger?.warn("state file could not be reset; leaving it as it is for this session", { mod: "state", statePath, err: error });
    return { state, writable: false };
  }
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
  /** Settles once every update has; rejects with the last update's failure, so quitting can log it. */
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
  let last: Promise<unknown> = Promise.resolve();
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
    last = operation;
    return operation;
  };
  return { update, flush: async () => { await last; } };
}
