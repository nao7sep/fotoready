import React from "react";
import type { OpRenderer } from "./op-renderer";

type LevelsParams = { blackPoint: number; whitePoint: number; gamma: number };

const MIN_LEVEL_SPAN = 1;
const DEFAULT_LEVELS: LevelsParams = { blackPoint: 0, whitePoint: 255, gamma: 1 };

export const levelsRenderer: OpRenderer<LevelsParams> = {
  type: "levels",
  Card({ params, disabled, onParamChange, onParamsChange }) {
    const gammaSliderValue = gammaToSliderValue(params.gamma);
    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Input: <strong>{params.blackPoint}-{params.whitePoint}</strong></span>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onParamsChange(DEFAULT_LEVELS)}>
            Reset
          </button>
        </div>
        <label className="slider-row">
          <span>Black point</span>
          <input
            disabled={disabled}
            max={Math.max(0, params.whitePoint - MIN_LEVEL_SPAN)}
            min={0}
            step={1}
            type="range"
            value={params.blackPoint}
            onChange={(e) => onParamChange("blackPoint", Math.min(e.currentTarget.valueAsNumber, params.whitePoint - MIN_LEVEL_SPAN))}
          />
          <span className="slider-value">{params.blackPoint}</span>
        </label>
        <label className="slider-row">
          <span>White point</span>
          <input
            disabled={disabled}
            max={255}
            min={Math.min(255, params.blackPoint + MIN_LEVEL_SPAN)}
            step={1}
            type="range"
            value={params.whitePoint}
            onChange={(e) => onParamChange("whitePoint", Math.max(e.currentTarget.valueAsNumber, params.blackPoint + MIN_LEVEL_SPAN))}
          />
          <span className="slider-value">{params.whitePoint}</span>
        </label>
        <label className="slider-row">
          <span>Gamma</span>
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
  return Math.round((Math.log2(gamma) / 2) * 100);
}

function sliderValueToGamma(value: number): number {
  return Math.pow(2, value / 50);
}
