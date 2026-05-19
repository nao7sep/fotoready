import React from "react";
import type { OpRenderer } from "./op-renderer";
import { ConcealOverlay } from "./_conceal-overlay";
import type { ConcealRegion } from "@shared/types/conceal";
import { patchFirstConcealRegion, readConcealRegionList } from "./_conceal-primitives";

type ConcealFillParams = { rects: ConcealRegion[]; color: string; opacity: number };

export const concealFillRenderer: OpRenderer<ConcealFillParams> = {
  type: "conceal-fill",
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
        <label className="span-two">
          Color
          <input disabled={disabled} type="color" value={params.color} onChange={(e) => onParamChange("color", e.currentTarget.value)} />
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.opacity} onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay: ConcealOverlay as never
};
