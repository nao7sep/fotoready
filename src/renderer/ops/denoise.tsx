import { useI18n } from "@renderer/i18n/I18nContext";
import type { OpRenderer } from "./op-renderer";

type DenoiseParams = { strength: number };

export const denoiseRenderer: OpRenderer<DenoiseParams> = {
  type: "denoise",
  Card({ params, disabled, onParamChange }) {
    const { t, percent } = useI18n();
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>{t("geometry.strength")}</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.strength} onChange={(e) => onParamChange("strength", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.strength <= 0 ? t("denoise.off") : percent(params.strength)}</span>
        </label>
      </div>
    );
  }
};
