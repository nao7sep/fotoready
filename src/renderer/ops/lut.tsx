import { useState } from "react";
import { LutPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { fileNameFromPath } from "@shared/file-path";
import type { OpCardProps, OpRenderer } from "./op-renderer";

type LutParams = { cubePath: string; strength: number };

export const lutRenderer: OpRenderer<LutParams> = {
  type: "lut",
  Card: LutCard
};

export function LutCard({ params, disabled, ctx, onParamChange }: OpCardProps<LutParams>): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadFailure, setReloadFailure] = useState<string | null>(null);
  const selected = ctx.luts.find((lut) => lut.path === params.cubePath) ?? null;

  async function openPicker(): Promise<void> {
    setReloadBusy(true);
    try {
      await ctx.reloadLuts?.();
      setReloadFailure(null);
      setPickerOpen(true);
    } catch (error) {
      setReloadFailure(presentFailure(
        error,
        "The LUT library could not be refreshed. The chooser remains closed; restore access to the LUT folder and try again.",
        "LUT library refresh before chooser failed",
        { opId: ctx.opId }
      ));
    } finally {
      setReloadBusy(false);
    }
  }

  return (
    <div className="geometry-controls">
      <div className="asset-source-row asset-source-row-value-only">
        <span className="asset-source-value" title={selected?.path ?? params.cubePath}>{selected?.name ?? fileLabel(params.cubePath) ?? "No LUT selected"}</span>
      </div>
      <button className="toolbar-button" disabled={disabled || reloadBusy} type="button" onClick={() => void openPicker()}>Choose LUT...</button>
      {reloadFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel="Close LUT chooser result"
          severity="error"
          onDismiss={() => setReloadFailure(null)}
        >
          {reloadFailure}
        </OperationResult>
      ) : null}
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

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  return fileNameFromPath(filePath);
}
