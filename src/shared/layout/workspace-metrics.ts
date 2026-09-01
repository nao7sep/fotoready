// Single source of truth for the workspace's pane minimums, splitter width, and fixed-chrome
// heights, plus the pure functions that derive the window's minimum size from them. Per the
// window-chrome conventions, the window minimum is the SUM of the pane minimums plus the splitters
// plus the fixed chrome — never a hand-typed literal that silently drifts when a pane changes.
//
// Consumed by both sides of the app: the main process reads it to size the BrowserWindow's
// minWidth/minHeight (src/main/bootstrap.ts), and the renderer reads it to clamp splitter drags
// and persisted widths against the same numbers (src/renderer/layout/workspace-layout.ts). Keeping
// it here, in @shared, is what guarantees the OS minimum and the in-page layout can never disagree.

/**
 * Minimum width (px) of each horizontally-arranged pane — the smallest size at which the pane's
 * content is still useful. `ops` and `addOps` are the two halves of the single Ops region (the
 * editable ops list + output, and the "add op" palette); both are always visible, so both count
 * toward the window minimum even though the region is one grid track with one splitter.
 */
export const PANE_MINS = {
  originals: 140,
  tasks: 170,
  editor: 360,
  ops: 230,
  addOps: 180
} as const;

/** The three side panes the user can resize (the editor is the fill pane and is never resized
 *  directly). Their widths are the persisted workspace layout. */
export type WorkspacePaneKey = "originals" | "tasks" | "ops" | "addOps";

/** The width each side pane starts at on a fresh install — the seed for the persisted layout and the
 *  basis for the first-run window size. Shared so the renderer, the state defaults, and the main
 *  process's window sizing all agree on one set of numbers. */
export const PANE_DEFAULTS: Record<WorkspacePaneKey, number> = {
  originals: 160,
  tasks: 200,
  ops: 260,
  addOps: 220
};

/** Per-pane maximums — the widest a side pane may grow. The minimum is PANE_MINS; a tighter live
 *  container cap is applied on top at display time (see clampPaneWidth / clampWidthsToContainer). */
export const PANE_MAXES: Record<WorkspacePaneKey, number> = {
  originals: 360,
  tasks: 420,
  ops: 520,
  addOps: 360
};

/** Width (px) of a workspace splitter. Mirrors `.workspace-splitter` in app.css. */
export const SPLITTER_WIDTH = 6;

/**
 * Fixed-chrome heights (px), reserved before the resizable content and counted toward the window
 * minimum so they are never the element clipped when space runs short. Each value mirrors a row in
 * app.css: `.app-shell` top row (`topBar`), `.preview-toolbar` (`previewToolbar`), and `.app-shell`
 * bottom row (`statusBar`).
 */
export const CHROME = {
  topBar: 48,
  previewToolbar: 36,
  statusBar: 32
} as const;

/**
 * Minimum useful height (px) of the resizable content beneath the fixed chrome — the smallest the
 * canvas/pane content area can be while staying usable. The window height minimum is this plus all
 * fixed chrome (see computeMinWindowHeight).
 */
export const CONTENT_MIN_HEIGHT = 320;

// The workspace lays out three side panes (originals, tasks, the Ops region) and the editor,
// separated by three splitters: originals | tasks | editor | ops-region.
const WORKSPACE_SPLITTER_COUNT = 3;

/**
 * The window's minimum width: the sum of every pane's minimum width plus the splitters between
 * them. Derived from PANE_MINS and SPLITTER_WIDTH so it can never disagree with the layout.
 */
export function computeMinWindowWidth(): number {
  const paneMinSum = PANE_MINS.originals + PANE_MINS.tasks + PANE_MINS.editor + PANE_MINS.ops + PANE_MINS.addOps;
  return paneMinSum + WORKSPACE_SPLITTER_COUNT * SPLITTER_WIDTH;
}

/**
 * The window's minimum height: the fixed chrome (top bar + preview toolbar + status bar) plus the
 * minimum useful content height. The preview toolbar is chrome inside the editor region; reserving
 * it alongside the top and status bars is what keeps any of them from being overlapped or clipped.
 */
export function computeMinWindowHeight(): number {
  return CHROME.topBar + CHROME.previewToolbar + CHROME.statusBar + CONTENT_MIN_HEIGHT;
}

/**
 * Content height (px) a fresh install opens with — taller than the bare CONTENT_MIN_HEIGHT so the
 * preview is usable out of the box, but deliberately modest: there is no point starting large when the
 * window size is remembered after the first resize.
 */
export const FIRST_RUN_CONTENT_HEIGHT = 680;

/**
 * The window's FIRST-RUN width: the smallest window that shows the default layout without cramping —
 * the side panes at their defaults, the editor at its own minimum, plus the splitters. There is no
 * larger "designed" default: after the first run the window remembers whatever size the user set
 * (UiState.windowSize), so the opening size only needs to be sensible, not spacious.
 */
export function computeFirstRunWindowWidth(): number {
  const sidePanes = PANE_DEFAULTS.originals + PANE_DEFAULTS.tasks + PANE_DEFAULTS.ops + PANE_DEFAULTS.addOps;
  return sidePanes + PANE_MINS.editor + WORKSPACE_SPLITTER_COUNT * SPLITTER_WIDTH;
}

/** The window's FIRST-RUN height: the fixed chrome plus a modest content height. */
export function computeFirstRunWindowHeight(): number {
  return CHROME.topBar + CHROME.previewToolbar + CHROME.statusBar + FIRST_RUN_CONTENT_HEIGHT;
}

/**
 * Clamp a remembered window size to the current display: never below the content minimum (a smaller
 * screen shrinks the window toward the minimum, and when the minimum itself exceeds a tiny screen the
 * minimum wins — a window wider than the screen beats truncated content), never larger than the work
 * area. Applied on every restore so unplugging a large external monitor yields a window that fits.
 * Pure — unit-tested without a real display.
 */
export function clampWindowSizeToWorkArea(
  size: { width: number; height: number },
  workArea: { width: number; height: number }
): { width: number; height: number } {
  return {
    width: clampWindowDimension(size.width, computeMinWindowWidth(), workArea.width),
    height: clampWindowDimension(size.height, computeMinWindowHeight(), workArea.height)
  };
}

function clampWindowDimension(value: number, min: number, workArea: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  const capped = Number.isFinite(workArea) && workArea > 0 ? Math.min(rounded, Math.round(workArea)) : rounded;
  return Math.max(min, capped);
}

/**
 * Clamp one pane's target width against both its own [min, max] and the live container, so a
 * widened pane can never push its siblings (especially the editor) below their minimums. The upper
 * bound is `container − Σ(other panes' minimums) − Σ(splitters)`: the widest this pane may grow
 * while still leaving every other pane its minimum. Pure so it can be unit-tested and reused on
 * drag, on window resize, and when restoring persisted widths.
 *
 * @param value         the requested width (e.g. from a drag delta)
 * @param min           this pane's own minimum
 * @param max           this pane's own maximum
 * @param othersMinSum  the summed minimums of all OTHER panes that share the container
 * @param container     the live container width available to all panes
 * @param splittersWidth total width consumed by splitters in the container
 */
export function clampPaneWidth(
  value: number,
  min: number,
  max: number,
  othersMinSum: number,
  container: number,
  splittersWidth: number
): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  // Headroom left for this pane once every sibling keeps its minimum and the splitters are
  // accounted for. Never let it fall below the pane's own min even on an absurdly small container.
  const containerCap = container - othersMinSum - splittersWidth;
  const upper = Math.max(min, Math.min(max, containerCap));
  return Math.min(upper, Math.max(min, rounded));
}
