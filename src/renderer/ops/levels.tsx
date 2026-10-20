import { CHANNEL_LIMITS, MIN_LEVEL_SPAN } from "@shared/op-limits";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { OpRenderer } from "./op-renderer";

type LevelsParams = { blackPoint: number; whitePoint: number; gamma: number };

const DEFAULT_LEVELS: LevelsParams = { blackPoint: CHANNEL_LIMITS.min, whitePoint: CHANNEL_LIMITS.max, gamma: 1 };

export const levelsRenderer: OpRenderer<LevelsParams> = {
  Card({ params, disabled, onParamChange, onParamsChange }) {
    const { t, rich } = useI18n();
    const gammaSliderValue = gammaToSliderValue(params.gamma);
    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">{rich("levels.inputStatus", { range: <strong>{params.blackPoint}-{params.whitePoint}</strong> })}</span>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onParamsChange(DEFAULT_LEVELS)}>
            {t("common.reset")}
          </button>
        </div>
        <label className="slider-row">
          <span>{t("levels.blackPoint")}</span>
          <input
            disabled={disabled}
            max={Math.max(CHANNEL_LIMITS.min, params.whitePoint - MIN_LEVEL_SPAN)}
            min={CHANNEL_LIMITS.min}
            step={1}
            type="range"
            value={params.blackPoint}
            onChange={(e) => onParamChange("blackPoint", Math.min(e.currentTarget.valueAsNumber, params.whitePoint - MIN_LEVEL_SPAN))}
          />
          <span className="slider-value">{params.blackPoint}</span>
        </label>
        <label className="slider-row">
          <span>{t("levels.whitePoint")}</span>
          <input
            disabled={disabled}
            max={CHANNEL_LIMITS.max}
            min={Math.min(CHANNEL_LIMITS.max, params.blackPoint + MIN_LEVEL_SPAN)}
            step={1}
            type="range"
            value={params.whitePoint}
            onChange={(e) => onParamChange("whitePoint", Math.max(e.currentTarget.valueAsNumber, params.blackPoint + MIN_LEVEL_SPAN))}
          />
          <span className="slider-value">{params.whitePoint}</span>
        </label>
        <label className="slider-row">
          <span>{t("levels.gamma")}</span>
          <input
            disabled={disabled}
            max={100}
            min={-100}
            step={1}
            type="range"
            value={gammaSliderValue}
            onChange={(e) => onParamChange("gamma", sliderValueToGamma(e.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{params.gamma.toFixed(2)}</span>
        </label>
      </div>
    );
  }
};

function gammaToSliderValue(gamma: number): number {
  return Math.round((-Math.log2(gamma) / 2) * 100);
}

function sliderValueToGamma(value: number): number {
  return Math.pow(2, -value / 50);
}
