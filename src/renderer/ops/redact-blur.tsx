import React from "react";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import type { FractionRect } from "./_overlay-primitives";

type RedactBlurParams = { rects: FractionRect[]; radius: number };

export const redactBlurRenderer: OpRenderer<RedactBlurParams> = {
  type: "redact-blur",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Radius — <strong>{params.radius.toFixed(3)}</strong>
          <input disabled={disabled} max={0.1} min={0.005} step={0.005} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  },
  Overlay: RedactOverlay as never
};
