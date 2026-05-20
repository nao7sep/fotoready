import React from "react";
import { MAX_RESIZE_DIMENSION, MAX_RESIZE_PIXELS } from "@shared/constants";
import type { OpRenderer } from "./op-renderer";

type ResizeMode = "fit" | "exact";
type ResizeUiMode = "fit" | "exact";
type ResizeParams = { mode: ResizeMode; width: number; height: number; interpolation: string };

const resizeModeOptions: ReadonlyArray<{ id: ResizeUiMode; label: string }> = [
  { id: "fit", label: "Fit" },
  { id: "exact", label: "Exact" }
];
const resizePresets = [200, 256, 400, 512, 800, 1024, 1280, 1600, 1920, 2048, 2560, 3200, 3840] as const;

export const resizeRenderer: OpRenderer<ResizeParams> = {
  type: "resize",
  Card({ params, disabled, onParamChange, onParamsChange }) {
    const activeMode = toUiMode(params.mode);
    const widthMax = maxResizeDimension(params.height);
    const heightMax = maxResizeDimension(params.width);

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Target: <strong>{params.width}×{params.height}px</strong></span>
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Resize mode">
          {resizeModeOptions.map((option) => (
            <button
              className={`toolbar-button compact-text ${activeMode === option.id ? "active" : ""}`}
              disabled={disabled}
              key={option.id}
              type="button"
              onClick={() => onParamChange("mode", option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Common resize presets">
          {resizePresets.map((preset) => (
            <button
              className="toolbar-button compact-text"
              disabled={disabled}
              key={preset}
              type="button"
              onClick={() => onParamsChange({ width: preset, height: preset })}
            >
              {preset}
            </button>
          ))}
        </div>
        <label className="slider-row">
          <span>Width</span>
          <input
            disabled={disabled}
            max={widthMax}
            min={1}
            step={1}
            type="range"
            value={params.width}
            onChange={(event) => onParamChange("width", clampResizeDimension(event.currentTarget.valueAsNumber, params.height))}
          />
          <span className="slider-value">{`${params.width}px`}</span>
        </label>
        <label className="slider-row">
          <span>Height</span>
          <input
            disabled={disabled}
            max={heightMax}
            min={1}
            step={1}
            type="range"
            value={params.height}
            onChange={(event) => onParamChange("height", clampResizeDimension(event.currentTarget.valueAsNumber, params.width))}
          />
          <span className="slider-value">{`${params.height}px`}</span>
        </label>
        <div className="modal-warning">Resize usually works best near the end of the pipeline.</div>
      </div>
    );
  }
};

function clampResizeDimension(value: number, otherDimension: number): number {
  return Math.max(1, Math.min(Math.round(value), maxResizeDimension(otherDimension)));
}

function maxResizeDimension(otherDimension: number): number {
  return Math.max(1, Math.min(MAX_RESIZE_DIMENSION, Math.floor(MAX_RESIZE_PIXELS / Math.max(1, otherDimension))));
}

function toUiMode(mode: ResizeMode): ResizeUiMode {
  if (mode === "exact") return "exact";
  return "fit";
}
