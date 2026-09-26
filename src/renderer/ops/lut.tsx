import { useI18n } from "@renderer/i18n/I18nContext";
import { useState } from "react";
import { LutPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { fileNameFromPath } from "@shared/file-path";
import type { OpCardProps, OpRenderer } from "./op-renderer";
import { message, type Message } from "@shared/i18n/translate";

type LutParams = { cubePath: string; strength: number };

export const lutRenderer: OpRenderer<LutParams> = {
  type: "lut",
  Card: LutCard
};

export function LutCard({ params, disabled, ctx, onParamChange }: OpCardProps<LutParams>): React.JSX.Element {
  const { t, text, percent } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadFailure, setReloadFailure] = useState<Message | null>(null);
  const selected = ctx.luts.find((lut) => lut.path === params.cubePath) ?? null;

  async function openPicker(): Promise<void> {
    setReloadBusy(true);
    try {
      await ctx.reloadLuts?.();
      setReloadFailure(null);
      setPickerOpen(true);
    } catch (error) {
      setReloadFailure(presentFailure(error, message("failure.lutRefresh"), "LUT library refresh before chooser failed", { opId: ctx.opId }));
    } finally {
      setReloadBusy(false);
    }
  }

  return (
    <div className="geometry-controls">
      <div className="asset-source-row asset-source-row-value-only">
        <span className="asset-source-value" title={selected?.path ?? params.cubePath}>{selected?.name ?? fileLabel(params.cubePath) ?? t("lut.noneSelected")}</span>
      </div>
      <button className="toolbar-button" disabled={disabled || reloadBusy} type="button" onClick={() => void openPicker()}>{t("lut.choose")}</button>
      {reloadFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel={t("lut.closeResult")}
          severity="error"
          onDismiss={() => setReloadFailure(null)}
        >
          {text(reloadFailure)}
        </OperationResult>
      ) : null}
      <label className="slider-row">
        <span>{t("geometry.strength")}</span>
        <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
        <span className="slider-value">{percent(params.strength)}</span>
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
