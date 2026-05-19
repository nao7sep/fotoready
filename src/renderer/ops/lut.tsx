import React from "react";
import { api } from "@renderer/ipc/client";
import type { OpRenderer } from "./op-renderer";

type LutParams = { cubePath: string; strength: number };

export const lutRenderer: OpRenderer<LutParams> = {
  type: "lut",
  Card({ params, disabled, ctx, onParamChange }) {
    const { luts } = ctx;
    return (
      <div className="geometry-controls">
        <label className="stacked-field">
          LUT
          <select disabled={disabled || luts.length === 0} value={params.cubePath} onChange={(e) => onParamChange("cubePath", e.currentTarget.value)}>
            <option value="">Choose a LUT</option>
            {luts.map((lut) => <option key={lut.path} value={lut.path}>{lut.name}</option>)}
          </select>
        </label>
        <button className="toolbar-button" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Cube LUT", extensions: ["cube"] });
          if (!picked) return;
          const imported = await api.luts.import(picked);
          await ctx.reloadLuts?.();
          onParamChange("cubePath", imported.path);
        }}>Import LUT...</button>
        <label className="slider-row">
          <span>Strength</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.strength * 100)}%`}</span>
        </label>
      </div>
    );
  }
};
