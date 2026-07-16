import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANE_MINS, SPLITTER_WIDTH } from "@shared/layout/workspace-metrics";
import {
  buildGridTemplateColumns,
  clampWidthsToContainer
} from "@renderer/layout/workspace-layout";

// Tests run in the node environment (no DOM). clampWidthsToContainer falls back to window.innerWidth
// only when a test omits the container; every test below passes one explicitly, so a roomy innerWidth
// is stubbed purely as a defensive default. Pane-width persistence lives in state.json now (no
// localStorage), so there is nothing storage-related to stub.
beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 4000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildGridTemplateColumns", () => {
  const widths = { originals: 160, tasks: 200, ops: 260, addOps: 220 };

  it("gives the editor a real minimum via minmax(editor min, 1fr)", () => {
    const template = buildGridTemplateColumns(widths, { showOps: true, showOriginals: true, showTasks: true });
    expect(template).toContain(`minmax(${PANE_MINS.editor}px, 1fr)`);
  });

  it("folds the two ops halves into one track and renders three splitters", () => {
    const template = buildGridTemplateColumns(widths, { showOps: true, showOriginals: true, showTasks: true });
    // Exactly three splitters: originals | tasks | editor | ops-region.
    const splitterTracks = template.split(" ").filter((track) => track === `${SPLITTER_WIDTH}px`);
    expect(splitterTracks).toHaveLength(3);
    // The Ops region is a single track sized to the sum of the two halves (260 + 220 = 480).
    expect(template).toContain(`${widths.ops + widths.addOps}px`);
    expect(template).not.toContain(`${widths.addOps}px ${widths.ops}px`);
  });

  it("drops a side pane's track and its splitter when that pane is hidden", () => {
    const template = buildGridTemplateColumns(widths, { showOps: false, showOriginals: false, showTasks: true });
    // Only the tasks splitter remains (tasks | editor); no ops region track.
    const splitterTracks = template.split(" ").filter((track) => track === `${SPLITTER_WIDTH}px`);
    expect(splitterTracks).toHaveLength(1);
    expect(template).not.toContain(`${widths.ops + widths.addOps}px`);
  });
});

describe("clampWidthsToContainer (display projection of intent)", () => {
  it("stops a widened pane at container - othersMin - editorMin - splitters", () => {
    // A container only just wide enough: every pane at its minimum plus the editor minimum and the
    // three splitters. ops requests far more than fits; the DISPLAY collapses to its own minimum
    // because there is no headroom (the underlying intent is untouched — see the mutation test below).
    const splitters = 3 * SPLITTER_WIDTH;
    const minimalContainer =
      PANE_MINS.originals + PANE_MINS.tasks + PANE_MINS.editor + PANE_MINS.ops + PANE_MINS.addOps + splitters;
    const clamped = clampWidthsToContainer(
      { originals: PANE_MINS.originals, tasks: PANE_MINS.tasks, ops: 9999, addOps: PANE_MINS.addOps },
      minimalContainer
    );
    expect(clamped.ops).toBe(PANE_MINS.ops);
  });

  it("leaves the editor its minimum: a widened pane never exceeds container - othersMin - splitters", () => {
    const container = 1200;
    const splitters = 3 * SPLITTER_WIDTH;
    const clamped = clampWidthsToContainer(
      { originals: PANE_MINS.originals, tasks: PANE_MINS.tasks, ops: 5000, addOps: PANE_MINS.addOps },
      container
    );
    const othersMin = PANE_MINS.editor + PANE_MINS.originals + PANE_MINS.tasks + PANE_MINS.addOps;
    expect(clamped.ops).toBe(container - othersMin - splitters);
  });

  it("keeps ALL panes collectively within the container, not just each against the others' minimums", () => {
    // The bug this pins: clampWidthsToContainer clamps each pane INDEPENDENTLY, capping each at
    // (container - the OTHER panes' MINIMUMS - splitters). That is correct for one widened pane, but
    // when several panes carry large intents at once, each clamp assumes the others are at their
    // minimums — they are not — so the displayed widths collectively overflow the container. The
    // editor track is minmax(editor min, 1fr) and cannot shrink below its minimum, so the grid
    // overruns the window and the rightmost pane (the Ops region) is pushed half off-screen.
    //
    // The invariant that must hold for the layout never to overflow: the displayed side panes plus
    // the editor's minimum plus the splitters fit the container.
    const container = 1280;
    const splitters = 3 * SPLITTER_WIDTH;
    const wideIntent = { originals: 360, tasks: 420, ops: 520, addOps: 360 }; // every pane near its max
    const display = clampWidthsToContainer(wideIntent, container);
    const sideSum = display.originals + display.tasks + display.ops + display.addOps;
    expect(sideSum + PANE_MINS.editor + splitters).toBeLessThanOrEqual(container);
  });

  it("still applies the per-pane max when it is tighter than the container cap", () => {
    // Roomy container, so the container cap is loose; ops' own max (520) is the binding limit.
    const clamped = clampWidthsToContainer(
      { originals: 160, tasks: 200, ops: 9999, addOps: 220 },
      4000
    );
    expect(clamped.ops).toBe(520);
  });

  it("derives display only — it never mutates the intent it is fed", () => {
    // The intent is a wide layout saved on a big window. Projecting it onto a tiny container must
    // narrow the DISPLAY toward the pane minimums while leaving the intent object byte-for-byte
    // unchanged, so a later window-grow can restore the intended widths.
    const intent = { originals: 320, tasks: 380, ops: 480, addOps: 300 };
    const snapshot = { ...intent };
    const tinyContainer =
      PANE_MINS.originals + PANE_MINS.tasks + PANE_MINS.editor + PANE_MINS.ops + PANE_MINS.addOps + 3 * SPLITTER_WIDTH;
    const display = clampWidthsToContainer(intent, tinyContainer);

    // Intent is left exactly as it was.
    expect(intent).toEqual(snapshot);
    // Display is a different object, clamped down to fit (ops collapses to its minimum here).
    expect(display).not.toBe(intent);
    expect(display.ops).toBe(PANE_MINS.ops);

    // Re-projecting the same untouched intent onto a roomy container returns the full intended widths.
    const restored = clampWidthsToContainer(intent, 4000);
    expect(restored).toEqual(snapshot);
  });
});

