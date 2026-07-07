import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  CHROME,
  PANE_MINS,
  SPLITTER_WIDTH,
  clampPaneWidth
} from "@shared/layout/workspace-metrics";

// The three side panes the user can resize. The editor is the fill pane (`minmax(editor min, 1fr)`)
// and is never resized directly, but its minimum is reserved in the clamp math so widening a side
// pane can never squeeze the editor below its own minimum. `ops` and `addOps` are the two halves of
// the single Ops region (the editable list + the "add op" palette); the `ops` splitter resizes the
// whole region, and `addOps` is the fixed width of the palette half inside it.
type PaneKey = "originals" | "tasks" | "ops" | "addOps";

type WorkspaceWidths = Record<PaneKey, number>;

const storageKey = "fotoready.workspace.widths";
const defaults: WorkspaceWidths = { originals: 160, tasks: 200, ops: 260, addOps: 220 };

// Per-pane maximums. The minimum for each pane is the single source of truth in PANE_MINS; the max
// only caps a pane from growing unreasonably wide (a tighter container cap is applied on top by
// clampPaneWidth).
const maxes: Record<PaneKey, number> = {
  originals: 360,
  tasks: 420,
  ops: 520,
  addOps: 360
};

const limits: Record<PaneKey, { min: number; max: number }> = {
  originals: { min: PANE_MINS.originals, max: maxes.originals },
  tasks: { min: PANE_MINS.tasks, max: maxes.tasks },
  ops: { min: PANE_MINS.ops, max: maxes.ops },
  addOps: { min: PANE_MINS.addOps, max: maxes.addOps }
};

// The Ops region is one grid track holding both ops sub-panes; its width is the sum of the two
// halves. The workspace lays out three side panes (originals, tasks, ops-region) and the editor,
// separated by three splitters.
const SIDE_SPLITTER_COUNT = 3;

export function useWorkspaceLayout({
  showOps,
  showOriginals,
  showTasks
}: {
  showOps: boolean;
  showOriginals: boolean;
  showTasks: boolean;
}): {
  gridTemplateColumns: string;
  addOpsWidth: number;
  startResize(pane: PaneKey): (event: ReactPointerEvent<HTMLButtonElement>) => void;
} {
  // INTENT, not display: the width the user dragged each adjustable pane to, in pixels. It is set
  // ONLY by a splitter drag and is the sole thing persisted. A window resize never touches it — the
  // user's intended widths survive a temporary shrink and reappear when the window grows again.
  const [intent, setIntent] = useState<WorkspaceWidths>(readStoredWidths);

  // The live workspace width, tracked so the DISPLAYED widths can be re-derived from the unchanged
  // intent whenever the window (and thus the workspace) changes size. Seeded from the current
  // container so the first paint already reflects the real width rather than the fallback.
  const [containerWidth, setContainerWidth] = useState<number>(() => currentContainerWidth());

  // Re-measure the container on every window resize and re-derive display from the unchanged intent.
  // This persists NOTHING: only the displayed grid template reacts to the window; the stored intent
  // stays exactly as the user dragged it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = (): void => setContainerWidth(currentContainerWidth());
    window.addEventListener("resize", onResize);
    // Measure once after mount: the real workspace element now exists, so the seeded value (which may
    // have used the fallback) is corrected without waiting for the first resize.
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // DISPLAY = clamp(min, intent, fitMax) against the live container. Window-shrink narrows each pane
  // toward its own minimum; window-grow returns it to the intended width. Derived, never persisted.
  const displayed = useMemo(
    () => clampWidthsToContainer(intent, containerWidth),
    [intent, containerWidth]
  );

  const gridTemplateColumns = useMemo(
    () => buildGridTemplateColumns(displayed, { showOps, showOriginals, showTasks }),
    [displayed, showOps, showOriginals, showTasks]
  );

  const startResize = useCallback((pane: PaneKey) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // Highlight only the splitter being dragged. The body class below is for the global resize
    // cursor + text-select lock, not the highlight — keying the highlight off it lit up every
    // splitter at once. Captured synchronously since the React event is reused after this handler.
    const splitter = event.currentTarget;
    const startX = event.clientX;
    // Drag from the pane's current DISPLAYED width, so the splitter tracks where the edge actually
    // sits even if the window had narrowed the pane below its intent.
    const startWidth = clampWidthsToContainer(intent, currentContainerWidth(event.currentTarget))[pane];
    // Ops splitters grow the pane when dragged left (toward the editor); the left panes grow right.
    const direction = pane === "ops" || pane === "addOps" ? -1 : 1;
    const container = workspaceContainerWidth(event.currentTarget);

    function onMove(moveEvent: PointerEvent): void {
      const requested = startWidth + (moveEvent.clientX - startX) * direction;
      // The dragged value is the new INTENT, clamped against the live container so the drag itself
      // can't push a sibling below its minimum. This clamped width is also what fits right now, so it
      // doubles as the intent: a window-grow later cannot widen a pane past where the user dragged it.
      const next = clampPaneWidth(
        requested,
        limits[pane].min,
        limits[pane].max,
        othersMinSum(pane),
        container,
        SIDE_SPLITTER_COUNT * SPLITTER_WIDTH
      );
      setIntent((current) => {
        const updated = { ...current, [pane]: next };
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-workspace");
      splitter.classList.remove("is-resizing");
    }

    document.body.classList.add("is-resizing-workspace");
    splitter.classList.add("is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [intent]);

  return { gridTemplateColumns, addOpsWidth: displayed.addOps, startResize };
}

// Pure builder for the workspace grid track template, exported for tests. The Ops region is a single
// track sized to the sum of its two halves (ops list + add-op palette), so the visible side panes
// are exactly originals, tasks, the Ops region, and the editor fill (`minmax(editor min, 1fr)`).
export function buildGridTemplateColumns(
  widths: WorkspaceWidths,
  visibility: { showOps: boolean; showOriginals: boolean; showTasks: boolean }
): string {
  const columns: string[] = [];
  if (visibility.showOriginals) columns.push(`${widths.originals}px`, `${SPLITTER_WIDTH}px`);
  if (visibility.showTasks) columns.push(`${widths.tasks}px`, `${SPLITTER_WIDTH}px`);
  columns.push(`minmax(${PANE_MINS.editor}px, 1fr)`);
  if (visibility.showOps) columns.push(`${SPLITTER_WIDTH}px`, `${widths.ops + widths.addOps}px`);
  return columns.join(" ");
}

// The summed minimums of every pane EXCEPT the one being resized, including the editor's own
// minimum. This is what a dragged pane must leave behind so no sibling — least of all the editor —
// is squeezed below its content minimum.
function othersMinSum(resizing: PaneKey): number {
  const all: Record<PaneKey, number> = {
    originals: PANE_MINS.originals,
    tasks: PANE_MINS.tasks,
    ops: PANE_MINS.ops,
    addOps: PANE_MINS.addOps
  };
  let sum = PANE_MINS.editor;
  for (const key of Object.keys(all) as PaneKey[]) {
    if (key !== resizing) sum += all[key];
  }
  return sum;
}

// The width available to the workspace panes. The splitter lives inside `.workspace`; walk up to it
// and use its measured width, falling back to the viewport when the DOM isn't measurable (e.g. the
// node-environment tests, which don't exercise a real drag).
function workspaceContainerWidth(from: HTMLElement): number {
  const workspace = from.closest(".workspace");
  const measured = workspace instanceof HTMLElement ? workspace.getBoundingClientRect().width : 0;
  if (measured > 0) return measured;
  return typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : computeFallbackContainer();
}

// A container wide enough that the per-pane min/max bounds, not the container cap, govern on load
// when no measurement is available: the sum of every pane's max plus the splitters.
function computeFallbackContainer(): number {
  return maxes.originals + maxes.tasks + PANE_MINS.editor + maxes.ops + maxes.addOps + SIDE_SPLITTER_COUNT * SPLITTER_WIDTH;
}

// Read the persisted INTENT widths verbatim — no container clamp. The stored value is the width the
// user dragged to and must survive a reopen on a narrow window unchanged; only the DISPLAY is clamped
// (see clampWidthsToContainer), and only at render time. Falls back to defaults on malformed JSON or
// a missing addOps (the marker that the stored shape predates this schema).
export function readStoredWidths(): WorkspaceWidths {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Partial<WorkspaceWidths>;
    if (typeof parsed.addOps !== "number") return { ...defaults };
    return {
      originals: Number(parsed.originals ?? defaults.originals),
      tasks: Number(parsed.tasks ?? defaults.tasks),
      ops: Number(parsed.ops ?? defaults.ops),
      addOps: Number(parsed.addOps ?? defaults.addOps)
    };
  } catch {
    return { ...defaults };
  }
}

// Derive DISPLAY widths from intent: clamp every pane against its own bounds and the live container,
// so the rendered grid always leaves the editor (and every other pane) its minimum. This is the
// display-only projection of the intent — it never mutates or persists the intent it is fed. Exported
// for tests.
export function clampWidthsToContainer(widths: WorkspaceWidths, container?: number): WorkspaceWidths {
  const available = container ?? currentContainerWidth();
  const splitters = SIDE_SPLITTER_COUNT * SPLITTER_WIDTH;
  const keys = Object.keys(limits) as PaneKey[];
  const result = {} as WorkspaceWidths;
  for (const key of keys) {
    result[key] = clampPaneWidth(widths[key], limits[key].min, limits[key].max, othersMinSum(key), available, splitters);
  }
  return result;
}

function currentContainerWidth(from?: HTMLElement | null): number {
  if (typeof document !== "undefined") {
    const workspace = from?.closest(".workspace") ?? document.querySelector(".workspace");
    if (workspace instanceof HTMLElement) {
      const measured = workspace.getBoundingClientRect().width;
      if (measured > 0) return measured;
    }
  }
  if (typeof window !== "undefined" && window.innerWidth > 0) return window.innerWidth;
  return computeFallbackContainer();
}

// Re-exported so the chrome heights have a single import surface for any future status-bar/min math
// in the renderer; keeps consumers from reaching past this module into @shared directly.
export { CHROME };
