import { useI18n } from "@renderer/i18n/I18nContext";
import type { OpRenderer } from "./op-renderer";

type UnsharpMaskParams = { radius: number; amount: number };

export const unsharpMaskRenderer: OpRenderer<UnsharpMaskParams> = {
  type: "unsharp-mask",
  Card({ params, disabled, onParamChange }) {
    const { t } = useI18n();
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>{t("geometry.radius")}</span>
          <input disabled={disabled} max={10} min={0.3} step={0.1} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.radius.toFixed(1)}</span>
        </label>
        <label className="slider-row">
          <span>{t("unsharp.amount")}</span>
          <input disabled={disabled} max={5} min={0} step={0.1} type="range" value={params.amount} onChange={(e) => onParamChange("amount", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.amount.toFixed(1)}</span>
        </label>
        <div className="modal-warning">{t("unsharp.hint")}</div>
      </div>
    );
  }
};
