import React from "react";
import { api } from "@renderer/ipc/client";
import type { OpRenderer } from "./op-renderer";

type LutParams = { cubePath: string; strength: number };

export const lutRenderer: OpRenderer<LutParams> = {
  type: "lut",
  Card({ params, disabled, ctx, onParamChange }) {
    const { luts } = ctx;
    return (
      <div className="field-grid">
        <label className="span-two">
          Saved LUT
          <select disabled={disabled || luts.length === 0} value={params.cubePath} onChange={(e) => onParamChange("cubePath", e.currentTarget.value)}>
            <option value="">Choose a LUT</option>
            {luts.map((lut) => <option key={lut.path} value={lut.path}>{lut.builtin ? "Built-in: " : ""}{lut.name}</option>)}
          </select>
        </label>
        <label className="span-two">
          .cube path
          <input disabled={disabled} type="text" value={params.cubePath} onChange={(e) => onParamChange("cubePath", e.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Cube LUT", extensions: ["cube"] });
          if (picked) onParamChange("cubePath", picked);
        }}>Browse LUT...</button>
        <label className="span-two">
          Strength
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
        </label>
      </div>
    );
  }
};
