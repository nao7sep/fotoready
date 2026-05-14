import React from "react";
import type { OpRenderer } from "./op-renderer";

type UnsharpMaskParams = { radius: number; amount: number; threshold: number; outputSharpen: boolean };

export const unsharpMaskRenderer: OpRenderer<UnsharpMaskParams> = {
  type: "unsharp-mask",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Radius — <strong>{params.radius.toFixed(1)}</strong>
          <input disabled={disabled} max={10} min={0.3} step={0.1} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Amount — <strong>{params.amount.toFixed(1)}</strong>
          <input disabled={disabled} max={5} min={0} step={0.1} type="range" value={params.amount} onChange={(e) => onParamChange("amount", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={params.outputSharpen} onChange={(e) => onParamChange("outputSharpen", e.currentTarget.checked)} />
          Output sharpen
        </label>
      </div>
    );
  }
};
