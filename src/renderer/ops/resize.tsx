import React from "react";
import type { OpRenderer } from "./op-renderer";

type ResizeMode = "long-edge" | "short-edge" | "width" | "height" | "fit" | "fill";
type ResizeParams = { mode: ResizeMode; value: number; interpolation: string };

const resizeModeOptions: ReadonlyArray<{ id: ResizeMode; label: string }> = [
  { id: "long-edge", label: "Long edge" },
  { id: "short-edge", label: "Short edge" },
  { id: "width", label: "Width" },
  { id: "height", label: "Height" },
  { id: "fit", label: "Fit" },
  { id: "fill", label: "Fill" }
];
const resizePresets = [640, 1200, 1600, 1920, 2560, 3840] as const;

export const resizeRenderer: OpRenderer<ResizeParams> = {
  type: "resize",
  Card({ params, disabled, onParamChange }) {
    const value = params.value;
    const sliderMax = Math.max(7680, Math.ceil(value / 320) * 320);
    const setValue = (next: number) => onParamChange("value", Math.max(1, Math.round(next)) as never);

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Target: <strong>{value}px</strong></span>
          <div className="geometry-stepper-group">
            {[-100, -10, 10, 100].map((delta) => (
              <button className="inline-action" disabled={disabled} key={delta} type="button" onClick={() => setValue(value + delta)}>
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
          </div>
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Resize mode">
          {resizeModeOptions.map((option) => (
            <button
              className={`geometry-chip ${params.mode === option.id ? "active" : ""}`}
              disabled={disabled}
              key={option.id}
              type="button"
              onClick={() => onParamChange("mode", option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="stacked-field geometry-range-field">
          Size
          <input disabled={disabled} max={sliderMax} min={64} step={16} type="range" value={value} onChange={(e) => setValue(e.currentTarget.valueAsNumber)} />
        </label>
        <div className="geometry-chip-group" role="group" aria-label="Common resize presets">
          {resizePresets.map((preset) => (
            <button className="geometry-chip" disabled={disabled} key={preset} type="button" onClick={() => setValue(preset)}>{preset}</button>
          ))}
        </div>
        <div className="geometry-toolbar-row">
          <label className="stacked-field geometry-number-field">
            Custom size
            <input disabled={disabled} min={1} type="number" value={value} onChange={(e) => setValue(e.currentTarget.valueAsNumber)} />
          </label>
          <div className="geometry-help">{describeMode(params.mode, value)}</div>
        </div>
      </div>
    );
  }
};

function describeMode(mode: ResizeMode, value: number): string {
  switch (mode) {
    case "long-edge": return `Set the long edge to ${value}px and preserve aspect ratio.`;
    case "short-edge": return `Set the short edge to ${value}px and preserve aspect ratio.`;
    case "width": return `Force width to ${value}px and derive height automatically.`;
    case "height": return `Force height to ${value}px and derive width automatically.`;
    case "fit": return `Fit the image inside a ${value}px square.`;
    case "fill": return `Fill a ${value}px square and crop to cover.`;
  }
}
