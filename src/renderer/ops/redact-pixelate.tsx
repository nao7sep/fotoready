import React from "react";
import type { RedactionRegion } from "@shared/types/redaction";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import { patchFirstRedactionRegion, readRedactionRegionList } from "./_redaction-primitives";

type RedactPixelateParams = { rects: RedactionRegion[]; blockSize: number };

export const redactPixelateRenderer: OpRenderer<RedactPixelateParams> = {
  type: "redact-pixelate",
  Card({ params, disabled, onParamChange }) {
    const firstRegion = readRedactionRegionList(params.rects)[0];
    return (
      <div className="geometry-controls">
        <div className="segmented-control">
          <button
            className={(firstRegion?.shape ?? "rectangle") === "rectangle" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => onParamChange("rects", patchFirstRedactionRegion(params.rects, { shape: "rectangle" }))}
          >
            Rectangle
          </button>
          <button
            className={(firstRegion?.shape ?? "rectangle") === "ellipse" ? "active" : ""}
            disabled={disabled}
            type="button"
            onClick={() => onParamChange("rects", patchFirstRedactionRegion(params.rects, { shape: "ellipse" }))}
          >
            Ellipse
          </button>
        </div>
        <label className="slider-row">
          <span>Block size</span>
          <input disabled={disabled} max={0.05} min={0.005} step={0.005} type="range" value={params.blockSize} onChange={(e) => onParamChange("blockSize", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${(params.blockSize * 100).toFixed(1)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay: RedactOverlay as never
};
