import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANE_MINS, SPLITTER_WIDTH } from "@shared/layout/workspace-metrics";
import {
  buildGridTemplateColumns,
  clampWidthsToContainer,
  readStoredWidths
} from "@renderer/layout/workspace-layout";

// Tests run in the node environment (no DOM). The layout module reads window.localStorage and,
// when re-clamping, falls back to window.innerWidth (document is absent). Stub a minimal localStorage
// and a roomy innerWidth so the per-pane bounds — not the container cap — govern unless a test sets a
// tight container explicitly.
const storageKey = "fotoready.workspace.widths";
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("window", {
    innerWidth: 4000,
    localStorage: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      }
    }
  });
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

describe("clampWidthsToContainer (sibling-aware clamp)", () => {
  it("stops a widened pane at container - othersMin - editorMin - splitters", () => {
    // A container only just wide enough: every pane at its minimum plus the editor minimum and the
    // three splitters. ops requests far more than fits; it must collapse to its own minimum because
    // there is no headroom.
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

  it("still applies the per-pane max when it is tighter than the container cap", () => {
    // Roomy container, so the container cap is loose; ops' own max (520) is the binding limit.
    const clamped = clampWidthsToContainer(
      { originals: 160, tasks: 200, ops: 9999, addOps: 220 },
      4000
    );
    expect(clamped.ops).toBe(520);
  });
});

describe("readStoredWidths", () => {
  it("returns clamped persisted widths when the stored JSON is well-formed", () => {
    store[storageKey] = JSON.stringify({ originals: 200, tasks: 250, ops: 300, addOps: 240 });
    const widths = readStoredWidths();
    // Roomy container (innerWidth 4000), so values within bounds pass through unchanged.
    expect(widths).toEqual({ originals: 200, tasks: 250, ops: 300, addOps: 240 });
  });

  it("clamps an out-of-bounds persisted width down to the pane max", () => {
    store[storageKey] = JSON.stringify({ originals: 9999, tasks: 250, ops: 300, addOps: 240 });
    const widths = readStoredWidths();
    expect(widths.originals).toBe(360); // originals max
  });

  it("falls back to defaults (clamped) when addOps is missing — the pre-schema marker", () => {
    store[storageKey] = JSON.stringify({ originals: 200, tasks: 250, ops: 300 });
    const widths = readStoredWidths();
    expect(widths).toEqual({ originals: 160, tasks: 200, ops: 260, addOps: 220 });
  });

  it("falls back to defaults (clamped) on malformed JSON", () => {
    store[storageKey] = "{not valid json";
    const widths = readStoredWidths();
    expect(widths).toEqual({ originals: 160, tasks: 200, ops: 260, addOps: 220 });
  });
});
