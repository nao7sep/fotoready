import React from "react";
import type { OpRenderer } from "./op-renderer";

type LevelsParams = { blackPoint: number; whitePoint: number; gamma: number };

export const levelsRenderer: OpRenderer<LevelsParams> = {
  type: "levels",
  Card({ params, disabled, onParamChange }) {
    const gammaSliderValue = gammaToSliderValue(params.gamma);
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>Black point</span>
          <input
            disabled={disabled}
            max={255}
            min={0}
            step={1}
            type="range"
            value={params.blackPoint}
            onChange={(e) => onParamChange("blackPoint", Math.min(e.currentTarget.valueAsNumber, params.whitePoint - 1))}
          />
          <span className="slider-value">{params.blackPoint}</span>
        </label>
        <label className="slider-row">
          <span>White point</span>
          <input
            disabled={disabled}
            max={255}
            min={0}
            step={1}
            type="range"
            value={params.whitePoint}
            onChange={(e) => onParamChange("whitePoint", Math.max(e.currentTarget.valueAsNumber, params.blackPoint + 1))}
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
