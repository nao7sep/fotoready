import React from "react";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import type { FractionRect } from "./_overlay-primitives";

type RedactPixelateParams = { rects: FractionRect[]; blockSize: number };

export const redactPixelateRenderer: OpRenderer<RedactPixelateParams> = {
  type: "redact-pixelate",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Block size — <strong>{params.blockSize.toFixed(3)}</strong>
          <input disabled={disabled} max={0.05} min={0.005} step={0.005} type="range" value={params.blockSize} onChange={(e) => onParamChange("blockSize", e.currentTarget.valueAsNumber)} />
        </label>
        <div className="row-detail span-two">Drag the rectangle on the preview to position and size it.</div>
      </div>
    );
  },
  Overlay: RedactOverlay as never
};
