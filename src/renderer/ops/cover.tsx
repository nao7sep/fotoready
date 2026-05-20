import React from "react";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealOverlay } from "./_conceal-overlay";
import { clampConcealRegion, patchFirstConcealRegion, readConcealRegionList } from "./_conceal-primitives";
import { ConcealGeometryControls } from "./_conceal-geometry-controls";
import { sliderLongEdge } from "./_slider-units";

type CoverParams = { rects: ConcealRegion[]; color: string; opacity: number };

export const coverRenderer: OpRenderer<CoverParams> = {
  type: "cover",
  Card({ params, disabled, ctx, onParamChange }) {
    const longEdge = sliderLongEdge(ctx.originalSize);
    const imageBounds = ctx.originalSize
      ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
      : { maxX: 1, maxY: 1 };
    const firstRegion = readConcealRegionList(params.rects)[0] ?? DEFAULT_CONCEAL_REGION;

    function patchRegion(patch: Partial<ConcealRegion>): void {
      const nextRegion = clampConcealRegion({ ...firstRegion, ...patch }, imageBounds);
      onParamChange("rects", patchFirstConcealRegion(params.rects, nextRegion));
    }

    return (
      <div className="geometry-controls">
        <div className="segmented-control">
          <button
            className={firstRegion.shape === "rectangle" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => patchRegion({ shape: "rectangle" })}
          >
            Rectangle
          </button>
          <button
            className={firstRegion.shape === "ellipse" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => patchRegion({ shape: "ellipse" })}
          >
            Ellipse
          </button>
        </div>
        <ConcealGeometryControls disabled={disabled} imageBounds={imageBounds} longEdge={longEdge} region={firstRegion} onChange={patchRegion} />
        <label className="conceal-color-row">
          <span>Color</span>
          <input disabled={disabled} type="color" value={params.color} onChange={(e) => onParamChange("color", e.currentTarget.value)} />
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={params.opacity} onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay: ConcealOverlay as never
};
