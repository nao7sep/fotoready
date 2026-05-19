import React from "react";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import type { RedactionRegion } from "@shared/types/redaction";
import { patchFirstRedactionRegion, readRedactionRegionList } from "./_redaction-primitives";

type RedactFillParams = { rects: RedactionRegion[]; color: string; opacity: number };

export const redactFillRenderer: OpRenderer<RedactFillParams> = {
  type: "redact-fill",
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
  Overlay: RedactOverlay as never
};
