import React from "react";
import type { OpRenderer } from "./op-renderer";

type DenoiseParams = { strength: number };

export const denoiseRenderer: OpRenderer<DenoiseParams> = {
  type: "denoise",
  Card({ params, disabled, onParamChange }) {
    return (
      <label className="stacked-field">
        Strength
        <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
      </label>
    );
  }
};
