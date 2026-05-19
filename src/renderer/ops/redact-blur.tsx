import React from "react";
import type { RedactionRegion } from "@shared/types/redaction";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import { patchFirstRedactionRegion, readRedactionRegionList } from "./_redaction-primitives";

type RedactBlurParams = { rects: RedactionRegion[]; radius: number };

export const redactBlurRenderer: OpRenderer<RedactBlurParams> = {
  type: "redact-blur",
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
          <span>Radius</span>
          <input disabled={disabled} max={40} min={1} step={1} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.radius.toFixed(0)}</span>
        </label>
      </div>
    );
  },
  Overlay: RedactOverlay as never
};
