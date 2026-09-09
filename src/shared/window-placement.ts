import type { WindowBounds, WindowPlacementMode, WindowPlacementRecord } from "./types/state";

export const DEFAULT_MAIN_WINDOW_MODE: WindowPlacementMode = "maximized";
export type WindowMinimumSize = { width: number; height: number };
export type WindowRestoration = { normalBounds: WindowBounds | null; mode: WindowPlacementMode };

export function resolveWindowRestoration(
  saved: WindowPlacementRecord | null,
  minimum: WindowMinimumSize,
  workAreas: readonly WindowBounds[],
  defaultMode: WindowPlacementMode = DEFAULT_MAIN_WINDOW_MODE,
): WindowRestoration {
  return {
    normalBounds: saved?.normalBounds ? fitWindowBounds(saved.normalBounds, minimum, workAreas) : null,
    mode: saved?.mode === "normal" || saved?.mode === "maximized" ? saved.mode : defaultMode,
  };
}

export function fitWindowBounds(
  bounds: WindowBounds,
  minimum: { width: number; height: number },
  workAreas: readonly WindowBounds[],
): WindowBounds | null {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)
    || bounds.width <= 0 || bounds.height <= 0) return null;
  const area = workAreas.find((item) =>
    [item.x, item.y, item.width, item.height].every(Number.isFinite)
    && item.width > 0 && item.height > 0
    && bounds.x < item.x + item.width && bounds.y < item.y + item.height
    && bounds.x + bounds.width > item.x && bounds.y + bounds.height > item.y);
  if (!area) return null;
  const width = Math.min(area.width, Math.max(minimum.width, bounds.width));
  const height = Math.min(area.height, Math.max(minimum.height, bounds.height));
  return {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    width, height,
  };
}
