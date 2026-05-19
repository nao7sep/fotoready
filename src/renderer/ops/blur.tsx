import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealOverlay } from "./_conceal-overlay";
import { patchFirstConcealRegion, readConcealRegionList } from "./_conceal-primitives";

type BlurParams = { rects: ConcealRegion[]; radius: number };

export const blurRenderer: OpRenderer<BlurParams> = {
  type: "blur",
  Card({ params, disabled, onParamChange }) {
    const firstRegion = readConcealRegionList(params.rects)[0];
    return (
      <div className="geometry-controls">
        <div className="segmented-control">
          <button
            className={(firstRegion?.shape ?? "rectangle") === "rectangle" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => onParamChange("rects", patchFirstConcealRegion(params.rects, { shape: "rectangle" }))}
          >
            Rectangle
          </button>
          <button
            className={(firstRegion?.shape ?? "rectangle") === "ellipse" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => onParamChange("rects", patchFirstConcealRegion(params.rects, { shape: "ellipse" }))}
          >
            Ellipse
          </button>
        </div>
        <label className="slider-row">
          <span>Radius</span>
          <input disabled={disabled} max={40} min={1} step={1} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.radius.toFixed(0)}</span>
        </label>
      </div>
    );
  },
  Overlay: ConcealOverlay as never
};
