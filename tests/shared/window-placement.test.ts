import { describe, expect, it } from "vitest";
import { fitWindowBounds, resolveWindowRestoration } from "@shared/window-placement";
import type { WindowPlacementRecord } from "@shared/types/state";

describe("window restoration", () => {
  const minimum = { width: 600, height: 400 };
  const areas = [{ x: 0, y: 30, width: 1920, height: 1010 }, { x: -1280, y: 30, width: 1280, height: 950 }];
  it("uses the approved default when state is absent", () => {
    expect(resolveWindowRestoration(null, minimum, areas)).toEqual({ normalBounds: null, mode: "maximized" });
  });
  it.each([640, 960])("preserves useful split placement at width %i", (width) => {
    const saved: WindowPlacementRecord = { normalBounds: { x: 0, y: 30, width, height: 1010 }, mode: "normal" };
    expect(resolveWindowRestoration(saved, minimum, areas)).toEqual(saved);
  });
  it("preserves a usable negative-origin display placement", () => {
    const saved: WindowPlacementRecord = { normalBounds: { x: -1200, y: 60, width: 1000, height: 700 }, mode: "normal" };
    expect(resolveWindowRestoration(saved, minimum, areas)).toEqual(saved);
  });
  it("fits partially visible and undersized bounds using work-area origins", () => {
    expect(fitWindowBounds({ x: -1200, y: 10, width: 500, height: 1000 }, minimum, [areas[1]!]))
      .toEqual({ x: -1200, y: 30, width: 600, height: 950 });
    expect(fitWindowBounds({ x: 1800, y: 900, width: 900, height: 700 }, minimum, areas))
      .toEqual({ x: 1020, y: 340, width: 900, height: 700 });
  });
  it("caps a minimum larger than the work area without inventing spare-space rules", () => {
    expect(fitWindowBounds({ x: 0, y: 30, width: 1200, height: 800 }, { width: 1400, height: 900 },
      [{ x: 0, y: 30, width: 1000, height: 700 }])).toEqual({ x: 0, y: 30, width: 1000, height: 700 });
  });
  it("does not drift when adjusted placement is restored repeatedly", () => {
    let bounds = { x: 1800, y: 900, width: 900, height: 700 };
    const adjusted = fitWindowBounds(bounds, minimum, areas)!;
    for (let restart = 0; restart < 5; restart++) bounds = fitWindowBounds(bounds, minimum, areas)!;
    expect(bounds).toEqual(adjusted);
  });
  it.each([NaN, Infinity, 0.5])("rejects malformed coordinate %s", (x) => {
    expect(fitWindowBounds({ x, y: 30, width: 900, height: 700 }, minimum, areas)).toBeNull();
  });
  it.each([0, -1])("rejects invalid size %s", (width) => {
    expect(fitWindowBounds({ x: 0, y: 30, width, height: 700 }, minimum, areas)).toBeNull();
  });
  it.each(["normal", "maximized"] as const)("preserves %s mode when the saved display is unavailable", (mode) => {
    expect(resolveWindowRestoration({ normalBounds: { x: 9999, y: 9999, width: 1200, height: 800 }, mode }, minimum, areas))
      .toEqual({ normalBounds: null, mode });
  });
});
