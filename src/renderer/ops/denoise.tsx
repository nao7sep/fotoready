import React from "react";
import type { OpRenderer } from "./op-renderer";

type DenoiseParams = { strength: number };

export const denoiseRenderer: OpRenderer<DenoiseParams> = {
  type: "denoise",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>Strength</span>
          <input disabled={disabled} max={1} min={0} step={0.2} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.strength <= 0 ? "Off" : `${Math.round(params.strength * 100)}%`}</span>
        </label>
      </div>
    );
  }
};
