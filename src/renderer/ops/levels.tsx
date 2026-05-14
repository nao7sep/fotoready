import React from "react";
import type { OpRenderer } from "./op-renderer";

type LevelsParams = { blackPoint: number; whitePoint: number; gamma: number };

export const levelsRenderer: OpRenderer<LevelsParams> = {
  type: "levels",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Black point — <strong>{params.blackPoint}</strong>
          <input disabled={disabled} max={254} min={0} step={1} type="range" value={params.blackPoint} onChange={(e) => onParamChange("blackPoint", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          White point — <strong>{params.whitePoint}</strong>
          <input disabled={disabled} max={255} min={1} step={1} type="range" value={params.whitePoint} onChange={(e) => onParamChange("whitePoint", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Gamma — <strong>{params.gamma.toFixed(2)}</strong>
          <input disabled={disabled} max={5} min={0.1} step={0.05} type="range" value={params.gamma} onChange={(e) => onParamChange("gamma", e.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }
};
