import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  CHROME,
  PANE_DEFAULTS,
  PANE_MAXES,
  PANE_MINS,
  SPLITTER_WIDTH,
  clampPaneWidth,
  type WorkspacePaneKey
} from "@shared/layout/workspace-metrics";

// The three side panes the user can resize. The editor is the fill pane (`minmax(editor min, 1fr)`)
// and is never resized directly, but its minimum is reserved in the clamp math so widening a side
// pane can never squeeze the editor below its own minimum. `ops` and `addOps` are the two halves of
// the single Ops region (the editable list + the "add op" palette); the `ops` splitter resizes the
// whole region, and `addOps` is the fixed width of the palette half inside it.
type PaneKey = WorkspacePaneKey;

export type WorkspaceWidths = Record<PaneKey, number>;

// Defaults and maximums live in @shared so the state layer (defaults + normalization) and the main
// process's window sizing read the same numbers. The minimum stays PANE_MINS; the max caps growth.
const limits: Record<PaneKey, { min: number; max: number }> = {
  originals: { min: PANE_MINS.originals, max: PANE_MAXES.originals },
  tasks: { min: PANE_MINS.tasks, max: PANE_MAXES.tasks },
  ops: { min: PANE_MINS.ops, max: PANE_MAXES.ops },
  addOps: { min: PANE_MINS.addOps, max: PANE_MAXES.addOps }
};

// The Ops region is one grid track holding both ops sub-panes; its width is the sum of the two
// halves. The workspace lays out three side panes (originals, tasks, ops-region) and the editor,
// separated by three splitters.
const SIDE_SPLITTER_COUNT = 3;

export function useWorkspaceLayout({
  showOps,
  showOriginals,
  showTasks,
  widths,
  onWidthsChange
}: {
  showOps: boolean;
  showOriginals: boolean;
  showTasks: boolean;
  // The persisted intent, supplied by the app once state.json has loaded (PANE_DEFAULTS until then).
  widths: WorkspaceWidths;
  // Persist a new intent — a drag only. Wired to `state.update({ workspaceWidths })` by the app.
  onWidthsChange(widths: WorkspaceWidths): void;
}): {
  gridTemplateColumns: string;
  addOpsWidth: number;
  startResize(pane: PaneKey): (event: ReactPointerEvent<HTMLButtonElement>) => void;
} {
  // INTENT, not display: the width the user dragged each adjustable pane to, in pixels. It is set
  // ONLY by a splitter drag and is the sole thing persisted. A window resize never touches it — the
  // user's intended widths survive a temporary shrink and reappear when the window grows again.
  //
  // Seeded from the `widths` prop and re-synced when that changes from OUTSIDE (state.json finishing
  // its async load, or a future reset). The value compare means our own persisted drag echoing back
  // through the prop is a no-op, so a drag is never fought by the sync.
  const [intent, setIntent] = useState<WorkspaceWidths>(widths);
  const widthsKey = `${widths.originals},${widths.tasks},${widths.ops},${widths.addOps}`;
  useEffect(() => {
    setIntent((current) =>
      current.originals === widths.originals &&
      current.tasks === widths.tasks &&
      current.ops === widths.ops &&
      current.addOps === widths.addOps
        ? current
        : widths
    );
  }, [widthsKey, widths]);

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
        onWidthsChange(updated);
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
  }, [intent, onWidthsChange]);

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
  return PANE_MAXES.originals + PANE_MAXES.tasks + PANE_MINS.editor + PANE_MAXES.ops + PANE_MAXES.addOps + SIDE_SPLITTER_COUNT * SPLITTER_WIDTH;
}

// Derive DISPLAY widths from intent so the rendered grid always leaves the editor its minimum and
// never overflows the container. This is the display-only projection of the intent — it never mutates
// or persists the intent it is fed. Exported for tests.
//
// Two stages, because a per-pane clamp is not enough. Clamping each pane against the OTHER panes'
// minimums (the old approach) lets several wide panes each "leave room for the others' minimums" while
// collectively overflowing — the editor track is minmax(editor min, 1fr) and cannot shrink below its
// minimum, so the surplus pushes the rightmost pane (the Ops region) half off-screen. So after the
// per-pane bounds, the side panes are fitted TOGETHER: if they don't leave the editor its minimum plus
// the splitters, they shrink jointly, proportional to each pane's spare room, none below its own
// minimum. When the container is at least the window minimum, the total spare room always covers the
// surplus, so the layout fits at any window size. A single wide pane still lands exactly where the old
// per-pane cap put it (container − others' minimums − splitters) — that is just this rule with only
// one pane holding any room.
export function clampWidthsToContainer(widths: WorkspaceWidths, container?: number): WorkspaceWidths {
  const available = container ?? currentContainerWidth();
  const splitters = SIDE_SPLITTER_COUNT * SPLITTER_WIDTH;
  const keys = Object.keys(limits) as PaneKey[];

  // Stage 1: each pane honors its own [min, max], independent of the container.
  const display = {} as WorkspaceWidths;
  for (const key of keys) {
    const requested = Number.isFinite(widths[key]) ? Math.round(widths[key]) : limits[key].min;
    display[key] = Math.min(limits[key].max, Math.max(limits[key].min, requested));
  }

  // Stage 2: fit the side panes together so the editor keeps its minimum and nothing overflows.
  const budget = available - PANE_MINS.editor - splitters;
  const room = (key: PaneKey): number => display[key] - limits[key].min;
  const surplus = (): number => keys.reduce((sum, key) => sum + display[key], 0) - budget;

  const over = surplus();
  if (over <= 0) return display;

  const totalRoom = keys.reduce((sum, key) => sum + room(key), 0);
  if (totalRoom > 0) {
    for (const key of keys) {
      const cut = Math.round((over * room(key)) / totalRoom);
      display[key] = Math.max(limits[key].min, display[key] - cut);
    }
  }
  // Rounding can leave a few px of residual overflow; trim it from whichever pane still has the most
  // room, so the final widths fit exactly. Terminates: each pass removes ≥1px of real room, and the
  // loop stops once nothing is over budget or no pane has room left (only when the container is below
  // the window minimum — which the OS minimum prevents).
  let residual = surplus();
  while (residual > 0) {
    const key = keys.filter((k) => room(k) > 0).sort((a, b) => room(b) - room(a))[0];
    if (!key) break;
    const cut = Math.min(residual, room(key));
    display[key] -= cut;
    residual -= cut;
  }
  return display;
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
