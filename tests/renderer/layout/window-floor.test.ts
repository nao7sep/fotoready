import { describe, expect, it } from "vitest";
import {
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";
import {
  WORKSPACE_FLOOR_STYLE,
  WORKSPACE_VIEWPORT_STYLE
} from "@renderer/layout/window-floor";

describe("workspace viewport floor", () => {
  it("owns the native viewport and its overflow", () => {
    expect(WORKSPACE_VIEWPORT_STYLE).toMatchObject({
      width: "100vw",
      height: "100vh",
      overflow: "auto"
    });
  });

  it("has both a definite ordinary height and the complete derived floor", () => {
    expect(WORKSPACE_FLOOR_STYLE).toEqual({
      height: "100%",
      minWidth: computeMinWindowWidth(),
      minHeight: computeMinWindowHeight()
    });
  });
});
