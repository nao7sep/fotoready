import type { WindowBounds, WindowPlacementMode, WindowPlacementRecord } from "./types/state";

export const DEFAULT_MAIN_WINDOW_MODE: WindowPlacementMode = "maximized";

export type WindowMinimumSize = {
  width: number;
  height: number;
};

export type WindowRestoration = {
  normalBounds: WindowBounds | null;
  mode: WindowPlacementMode;
};

/**
 * Treat geometry and mode independently: unusable bounds fall back to the app's designed opening
 * rectangle, while a valid maximized preference can still be restored.
 */
export function resolveWindowRestoration(
  saved: WindowPlacementRecord | null,
  minimum: WindowMinimumSize,
  workAreas: readonly WindowBounds[],
  defaultMode: WindowPlacementMode = DEFAULT_MAIN_WINDOW_MODE
): WindowRestoration {
  return {
    normalBounds:
      saved?.normalBounds && isUsableWindowBounds(saved.normalBounds, minimum, workAreas)
        ? { ...saved.normalBounds }
        : null,
    mode: saved?.mode === "normal" || saved?.mode === "maximized" ? saved.mode : defaultMode
  };
}

export function isUsableWindowBounds(
  bounds: WindowBounds,
  minimum: WindowMinimumSize,
  workAreas: readonly WindowBounds[]
): boolean {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger)) return false;
  if (bounds.width < minimum.width || bounds.height < minimum.height) return false;

  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return workAreas.some((workArea) => {
    if (![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)) return false;
    return (
      bounds.x >= workArea.x &&
      bounds.y >= workArea.y &&
      right <= workArea.x + workArea.width &&
      bottom <= workArea.y + workArea.height
    );
  });
}
