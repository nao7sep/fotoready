import { describe, expect, it } from "vitest";
import {
  CHROME,
  CONTENT_MIN_HEIGHT,
  FIRST_RUN_CONTENT_HEIGHT,
  PANE_DEFAULTS,
  PANE_MINS,
  SPLITTER_WIDTH,
  clampPaneWidth,
  clampWindowSizeToWorkArea,
  computeFirstRunWindowHeight,
  computeFirstRunWindowWidth,
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";

describe("workspace-metrics", () => {
  describe("computeMinWindowWidth", () => {
    it("is the sum of every pane minimum plus the three splitters", () => {
      // Derived, not guessed: originals + tasks + editor + ops + addOps + 3 splitters.
      const expected =
        PANE_MINS.originals + PANE_MINS.tasks + PANE_MINS.editor + PANE_MINS.ops + PANE_MINS.addOps + 3 * SPLITTER_WIDTH;
      expect(computeMinWindowWidth()).toBe(expected);
    });

    it("matches the current derived literal (guard against silent drift)", () => {
      // 140 + 170 + 360 + 230 + 180 = 1080, + 18 (3 x 6px splitters) = 1098. If a pane minimum or
      // the splitter width changes, this literal must change with it — that is the point.
      expect(computeMinWindowWidth()).toBe(1098);
    });

    it("reserves room for every pane: subtracting all but one still leaves that one its minimum", () => {
      const total = computeMinWindowWidth();
      const splitters = 3 * SPLITTER_WIDTH;
      const editorHeadroom =
        total - splitters - PANE_MINS.originals - PANE_MINS.tasks - PANE_MINS.ops - PANE_MINS.addOps;
      expect(editorHeadroom).toBe(PANE_MINS.editor);
    });
  });

  describe("computeMinWindowHeight", () => {
    it("is the fixed chrome plus the minimum content height", () => {
      expect(computeMinWindowHeight()).toBe(
        CHROME.topBar + CHROME.previewToolbar + CHROME.statusBar + CONTENT_MIN_HEIGHT
      );
    });

    it("matches the current derived literal (guard against silent drift)", () => {
      // 48 (top bar) + 36 (preview toolbar) + 32 (status bar) + 320 (content) = 436.
      expect(computeMinWindowHeight()).toBe(436);
    });

    it("reserves all three fixed chrome bars so none can be clipped", () => {
      const contentOnly = computeMinWindowHeight() - CHROME.topBar - CHROME.previewToolbar - CHROME.statusBar;
      expect(contentOnly).toBe(CONTENT_MIN_HEIGHT);
    });
  });

  describe("computeFirstRunWindowWidth", () => {
    it("is side panes at their defaults + the editor minimum + the splitters", () => {
      const expected =
        PANE_DEFAULTS.originals + PANE_DEFAULTS.tasks + PANE_DEFAULTS.ops + PANE_DEFAULTS.addOps +
        PANE_MINS.editor + 3 * SPLITTER_WIDTH;
      expect(computeFirstRunWindowWidth()).toBe(expected);
    });

    it("is the smallest window that shows the default layout without cramping (>= the minimum)", () => {
      // 840 side defaults + 360 editor + 18 splitters = 1218, above the 1098 bare minimum.
      expect(computeFirstRunWindowWidth()).toBe(1218);
      expect(computeFirstRunWindowWidth()).toBeGreaterThan(computeMinWindowWidth());
    });
  });

  describe("computeFirstRunWindowHeight", () => {
    it("is the fixed chrome plus the first-run content height", () => {
      expect(computeFirstRunWindowHeight()).toBe(
        CHROME.topBar + CHROME.previewToolbar + CHROME.statusBar + FIRST_RUN_CONTENT_HEIGHT
      );
    });

    it("is taller than the bare minimum so the preview is usable out of the box", () => {
      expect(computeFirstRunWindowHeight()).toBeGreaterThan(computeMinWindowHeight());
    });
  });

  describe("clampWindowSizeToWorkArea", () => {
    it("keeps a size that already fits the screen", () => {
      const size = { width: 1400, height: 900 };
      expect(clampWindowSizeToWorkArea(size, { width: 2560, height: 1440 })).toEqual(size);
    });

    it("shrinks a size saved on a big monitor to fit a smaller screen", () => {
      // Unplug the external monitor: a 3000x2000 layout clamps to the 1440x900 laptop.
      const clamped = clampWindowSizeToWorkArea({ width: 3000, height: 2000 }, { width: 1440, height: 900 });
      expect(clamped).toEqual({ width: 1440, height: 900 });
    });

    it("never returns below the content minimum, even on a screen smaller than the minimum", () => {
      // A screen narrower than the content minimum: the minimum wins (content must not truncate).
      const clamped = clampWindowSizeToWorkArea({ width: 800, height: 400 }, { width: 900, height: 500 });
      expect(clamped.width).toBe(computeMinWindowWidth());
      expect(clamped.height).toBe(computeMinWindowHeight());
    });

    it("ignores a non-finite work area (leaves the size floored at the minimum)", () => {
      const clamped = clampWindowSizeToWorkArea({ width: 1400, height: 900 }, { width: Number.NaN, height: 0 });
      expect(clamped).toEqual({ width: 1400, height: 900 });
    });
  });

  describe("clampPaneWidth", () => {
    // A roomy container where the per-pane bounds, not the container cap, govern.
    const wideContainer = 4000;
    const splitters = 3 * SPLITTER_WIDTH;

    it("returns the requested width when it is within bounds and the container is roomy", () => {
      expect(clampPaneWidth(300, 140, 360, 1000, wideContainer, splitters)).toBe(300);
    });

    it("clamps to the pane's own min and max when those are the tightest bound", () => {
      expect(clampPaneWidth(50, 140, 360, 1000, wideContainer, splitters)).toBe(140);
      expect(clampPaneWidth(9999, 140, 360, 1000, wideContainer, splitters)).toBe(360);
    });

    it("clamps against the container minus other panes' minimums and the splitters", () => {
      // container 1000, othersMin 600, splitters 18 -> this pane may grow to at most 382, even
      // though its own max is 800.
      expect(clampPaneWidth(800, 140, 800, 600, 1000, 18)).toBe(1000 - 600 - 18);
    });

    it("never returns below the pane's own minimum even on an absurdly small container", () => {
      // The container cap would be negative here; the pane's own minimum still wins.
      expect(clampPaneWidth(500, 140, 360, 900, 100, 18)).toBe(140);
    });

    it("falls back to the minimum for a non-finite request", () => {
      expect(clampPaneWidth(Number.NaN, 140, 360, 600, wideContainer, splitters)).toBe(140);
    });

    it("rounds fractional requests", () => {
      expect(clampPaneWidth(200.6, 140, 360, 600, wideContainer, splitters)).toBe(201);
    });
  });
});
