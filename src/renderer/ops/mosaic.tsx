import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealOverlay } from "./_conceal-overlay";
import { patchFirstConcealRegion, readConcealRegionList } from "./_conceal-primitives";
import { AngleControl, normalizeAngle } from "./_angle-controls";

type MosaicParams = { rects: ConcealRegion[]; blockSize: number };

export const mosaicRenderer: OpRenderer<MosaicParams> = {
  type: "mosaic",
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
          <span>Cell size</span>
          <input disabled={disabled} max={0.05} min={0.005} step={0.005} type="range" value={params.blockSize} onChange={(e) => onParamChange("blockSize", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${(params.blockSize * 100).toFixed(1)}%`}</span>
        </label>
        <AngleControl disabled={disabled} value={firstRegion?.rotation ?? 0} onChange={(rotation) => onParamChange("rects", patchFirstConcealRegion(params.rects, { rotation: normalizeAngle(rotation) }))} />
      </div>
    );
  },
  Overlay: ConcealOverlay as never
};
