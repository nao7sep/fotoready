import React from "react";
import type { OpRenderer } from "./op-renderer";

type CurvesParams = { rgb: Array<[number, number]> };

const inputValues = [0, 64, 128, 192, 255];
const labels = ["Blacks", "Shadows", "Midtones", "Lights", "Whites"];
const curvePresets = [
  { id: "neutral", label: "Neutral", rgb: [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]] },
  { id: "recover-dark-details", label: "Recover dark details", rgb: [[0, 0], [64, 86], [128, 144], [192, 212], [255, 255]] },
  { id: "brighten-midtones", label: "Brighten midtones", rgb: [[0, 0], [64, 92], [128, 156], [192, 218], [255, 255]] },
  { id: "add-contrast", label: "Add contrast", rgb: [[0, 0], [64, 44], [128, 128], [192, 214], [255, 255]] },
  { id: "fade-blacks", label: "Fade blacks", rgb: [[0, 14], [64, 72], [128, 136], [192, 208], [255, 245]] }
] satisfies ReadonlyArray<{ id: string; label: string; rgb: Array<[number, number]> }>;

export const curvesRenderer: OpRenderer<CurvesParams> = {
  type: "curves",
  Card({ params, disabled, onParamChange }) {
    const points = params.rgb.length >= 2 ? params.rgb : [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]] as Array<[number, number]>;
    return (
      <div className="geometry-controls">
        <div className="geometry-chip-group" role="group" aria-label="Curves presets">
          {curvePresets.map((preset) => (
            <button
              className={`toolbar-button compact-text ${sameCurve(points, preset.rgb) ? "active" : ""}`}
              disabled={disabled}
              key={preset.id}
              type="button"
              onClick={() => onParamChange("rgb", preset.rgb as never)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {points.map((point, index) => (
          <label className="slider-row" key={index}>
            <span>{labels[index] ?? `Point ${index + 1}`}</span>
            <input
              disabled={disabled}
              max={255}
              min={0}
              step={1}
              type="range"
              value={point[1]}
              onChange={(e) => onParamChange("rgb", points.map((item, i) => i === index ? [item[0], e.currentTarget.valueAsNumber] : item) as never)}
            />
            <span className="slider-value">{`${inputValues[index] ?? point[0]}\u2192${point[1]}`}</span>
          </label>
        ))}
      </div>
    );
  }
};

function sameCurve(left: Array<[number, number]>, right: Array<[number, number]>): boolean {
  return left.length === right.length && left.every((point, index) => point[0] === right[index]?.[0] && point[1] === right[index]?.[1]);
}
