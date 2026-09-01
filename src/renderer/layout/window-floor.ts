import type { CSSProperties } from "react";
import {
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";

/** The native-sized viewport owns overflow when the complete workspace floor cannot fit. */
export const WORKSPACE_VIEWPORT_STYLE: CSSProperties = {
  width: "100vw",
  height: "100vh",
  overflow: "auto"
};

/**
 * A definite ordinary height lets the shell's grid divide the visible viewport below its fixed
 * chrome. The independent minimums keep the full pane floor intact and make the outer viewport
 * scroll only when that floor is physically larger.
 */
export const WORKSPACE_FLOOR_STYLE: CSSProperties = {
  height: "100%",
  minWidth: computeMinWindowWidth(),
  minHeight: computeMinWindowHeight()
};
