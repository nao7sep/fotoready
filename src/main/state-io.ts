import fs from "node:fs/promises";
import type { UiState } from "@shared/types/state";
import { defaultUiState, normalizeUiState, type UiStateNormalizationResult } from "@shared/validation/state";
import { headeredJson, parseHeaderedJson, type HeaderedJsonRead } from "@shared/file-header";
import { APP_WRITER } from "./app-writer";
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
 * `state.json` is disposable UI state, so losing it never costs more than a pane width or window
 * position: what cannot be read is replaced by
 * defaults, in memory only when the file cannot be read or written, so it never stops startup.
 */
export async function loadState(statePath: string, logger?: AppLogger): Promise<LoadedState> {
  let read: HeaderedJsonRead;
  try {
    read = parseHeaderedJson(await fs.readFile(statePath, "utf8"), "state");
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
  // not recorded: state.json is UI state (pane widths, histogram placement), not the user's work.
  await atomicWriteFile(statePath, headeredJson("state", APP_WRITER, normalized));
}

export type StateCoordinator = {
  update(patch: Partial<UiState> | ((current: Readonly<UiState>) => Partial<UiState>)): Promise<UiStateNormalizationResult>;
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
  let intendedState = { ...currentState };
  let submission = 0;
  let tail: Promise<void> = Promise.resolve();
  let last: Promise<unknown> = Promise.resolve();
  const update = (patch: Partial<UiState> | ((current: Readonly<UiState>) => Partial<UiState>)): Promise<UiStateNormalizationResult> => {
    // Capture each intent against the latest submitted intent, including writes still pending.
    const id = ++submission;
    const candidate = { ...intendedState, ...(typeof patch === "function" ? patch(intendedState) : patch) };
    const result = normalizeUiState(candidate, intendedState);
    intendedState = result.state;
    const operation = tail.then(async () => {
      try {
        if (loaded.writable) await writer(statePath, result.state);
        Object.assign(currentState, result.state);
        return result;
      } catch (error) {
        // Only the latest failed intent can reset the next input's basis. A newer queued intent
        // already incorporates every action, and must not be overwritten by this older failure.
        if (id === submission) intendedState = { ...currentState };
        throw error;
      }
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
