import React from "react";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";
import type { OpRenderer } from "./op-renderer";

type CurvePoint = [number, number];
type CurvesParams = { rgb: CurvePoint[] };

const defaultCurve: CurvePoint[] = [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
const labels = ["Blacks", "Shadows", "Midtones", "Lights", "Whites"];
const curvePresets: ReadonlyArray<{ id: string; label: string; rgb: CurvePoint[] }> = [
  { id: "neutral", label: "Neutral", rgb: defaultCurve },
  { id: "recover-dark-details", label: "Recover dark details", rgb: [[0, 0], [64, 86], [128, 144], [192, 212], [255, 255]] },
  { id: "brighten-midtones", label: "Brighten midtones", rgb: [[0, 0], [64, 92], [128, 156], [192, 218], [255, 255]] },
  { id: "add-contrast", label: "Add contrast", rgb: [[0, 0], [64, 44], [128, 128], [192, 214], [255, 255]] },
  { id: "fade-blacks", label: "Fade blacks", rgb: [[0, 14], [64, 72], [128, 136], [192, 208], [255, 245]] }
];

export const curvesRenderer: OpRenderer<CurvesParams> = {
  type: "curves",
  Card({ params, disabled, onParamChange }) {
    const points = params.rgb.length >= 2 ? params.rgb : defaultCurve;
    return (
      <div className="geometry-controls">
        <SegmentedRadioGroup
          className="geometry-chip-group"
          optionClassName="toolbar-button compact-text"
          ariaLabel="Curves presets"
          options={curvePresets}
          value={curvePresets.find((preset) => sameCurve(points, preset.rgb))?.id ?? null}
          onChange={(id) => {
            const preset = curvePresets.find((p) => p.id === id);
            if (preset) onParamChange("rgb", preset.rgb);
          }}
          disabled={disabled}
        />
        {points.map((point, index) => (
          <div className="geometry-controls" key={index}>
            <div className="geometry-status">
              {labels[index] ?? `Point ${index + 1}`}: <strong>{Math.round(point[0])}→{Math.round(point[1])}</strong>
            </div>
            <label className="slider-row">
              <span>Input</span>
              <input
                disabled={disabled}
                max={255}
                min={0}
                step={1}
                type="range"
                value={point[0]}
                onChange={(e) => onParamChange("rgb", updateCurvePoint(points, index, [e.currentTarget.valueAsNumber, point[1]]))}
              />
              <span className="slider-value">{Math.round(point[0])}</span>
            </label>
            <label className="slider-row">
              <span>Output</span>
              <input
                disabled={disabled}
                max={255}
                min={0}
                step={1}
                type="range"
                value={point[1]}
                onChange={(e) => onParamChange("rgb", updateCurvePoint(points, index, [point[0], e.currentTarget.valueAsNumber]))}
              />
              <span className="slider-value">{Math.round(point[1])}</span>
            </label>
          </div>
        ))}
      </div>
    );
  }
};

function updateCurvePoint(points: CurvePoint[], index: number, point: CurvePoint): CurvePoint[] {
  return points.map((item, i): CurvePoint => i === index ? point : item);
}

function sameCurve(left: CurvePoint[], right: CurvePoint[]): boolean {
  return left.length === right.length && left.every((point, index) => point[0] === right[index]?.[0] && point[1] === right[index]?.[1]);
}
