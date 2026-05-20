import React from "react";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealOverlay } from "./_conceal-overlay";
import { clampConcealRegion, readConcealRegionList, replacePrimaryConcealRegion, updateConcealRegion } from "./_conceal-primitives";
import { ConcealGeometryControls } from "./_conceal-geometry-controls";
import { sliderLongEdge } from "./_slider-units";

type BlurParams = { rects: ConcealRegion[]; radius: number };

export const blurRenderer: OpRenderer<BlurParams> = {
  type: "blur",
  Card({ params, disabled, ctx, onParamChange }) {
    const longEdge = sliderLongEdge(ctx.originalSize);
    const imageBounds = ctx.originalSize
      ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
      : { maxX: 1, maxY: 1 };
    const firstRegion = clampConcealRegion(readConcealRegionList(params.rects)[0] ?? DEFAULT_CONCEAL_REGION, imageBounds);

    function updateRegion(updates: Partial<ConcealRegion>): void {
      const nextRegion = updateConcealRegion(firstRegion, updates, imageBounds);
      onParamChange("rects", replacePrimaryConcealRegion(params.rects, nextRegion));
    }

    return (
      <div className="geometry-controls">
        <div className="segmented-control">
          <button
            className={firstRegion.shape === "rectangle" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => updateRegion({ shape: "rectangle" })}
          >
            Rectangle
          </button>
          <button
            className={firstRegion.shape === "ellipse" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => updateRegion({ shape: "ellipse" })}
          >
            Ellipse
          </button>
        </div>
        <ConcealGeometryControls disabled={disabled} imageBounds={imageBounds} region={firstRegion} onChange={updateRegion} />
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
