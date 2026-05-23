import React, { useState } from "react";
import { LutPickerModal } from "@renderer/components/modals/asset-picker-modal";
import type { OpRenderer } from "./op-renderer";

type LutParams = { cubePath: string; strength: number };

export const lutRenderer: OpRenderer<LutParams> = {
  type: "lut",
  Card({ params, disabled, ctx, onParamChange }) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const selected = ctx.luts.find((lut) => lut.path === params.cubePath) ?? null;
    return (
      <div className="geometry-controls">
        <div className="asset-source-row">
          <span className="asset-source-label">LUT</span>
          <span className="asset-source-value" title={selected?.path ?? params.cubePath}>{selected?.name ?? fileLabel(params.cubePath) ?? "No LUT selected"}</span>
        </div>
        <button className="toolbar-button" disabled={disabled} type="button" onClick={() => {
          void ctx.reloadLuts?.();
          setPickerOpen(true);
        }}>Choose LUT...</button>
        <label className="slider-row">
          <span>Strength</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.strength * 100)}%`}</span>
        </label>
        {pickerOpen ? (
          <LutPickerModal
            luts={ctx.luts}
            previewLongEdge={ctx.assetPickerPreviewLongEdge}
            selectedPath={params.cubePath}
            strength={params.strength}
            targetOpId={ctx.opId}
            taskId={ctx.activeTaskId}
            onClose={() => setPickerOpen(false)}
            onReload={ctx.reloadLuts ?? (() => Promise.resolve())}
            onUse={(path) => onParamChange("cubePath", path)}
          />
        ) : null}
      </div>
    );
  }
};

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  return fileName.replace(/\.[^.]+$/, "");
}
