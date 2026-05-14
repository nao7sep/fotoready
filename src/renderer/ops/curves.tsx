import React from "react";
import type { OpRenderer } from "./op-renderer";

type CurvesParams = { rgb: Array<[number, number]> };

const inputValues = [0, 64, 128, 192, 255];
const labels = ["Shadows", "Dark", "Midtones", "Light", "Highlights"];

export const curvesRenderer: OpRenderer<CurvesParams> = {
  type: "curves",
  Card({ params, disabled, onParamChange }) {
    const points = params.rgb.length >= 2 ? params.rgb : [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]] as Array<[number, number]>;
    return (
      <div className="field-grid">
        {points.map((point, index) => (
          <label className="span-two" key={index}>
            {labels[index] ?? `Point ${index + 1}`} — in {inputValues[index] ?? point[0]}, out <strong>{point[1]}</strong>
            <input
              disabled={disabled}
              max={255}
              min={0}
              step={1}
              type="range"
              value={point[1]}
              onChange={(e) => onParamChange("rgb", points.map((item, i) => i === index ? [item[0], e.currentTarget.valueAsNumber] : item) as never)}
            />
          </label>
        ))}
      </div>
    );
  }
};
