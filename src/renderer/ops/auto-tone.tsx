import React from "react";
import type { OpRenderer } from "./op-renderer";

type AutoToneParams = { enabled: boolean; strength: number };

export const autoToneRenderer: OpRenderer<AutoToneParams> = {
  type: "auto-tone",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="toggle-row span-two">
          <input disabled={disabled} type="checkbox" checked={params.enabled} onChange={(e) => onParamChange("enabled", e.currentTarget.checked)} />
          Enabled
        </label>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }
};
