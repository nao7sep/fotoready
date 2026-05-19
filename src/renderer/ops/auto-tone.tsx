import React from "react";
import type { OpRenderer } from "./op-renderer";

type AutoToneParams = { shadowClip: number; highlightClip: number };

const autoTonePresets = [
  { id: "0", label: "0%", shadowClip: 0, highlightClip: 0 },
  { id: "0.1", label: "0.1%", shadowClip: 0.1, highlightClip: 0.1 },
  { id: "0.25", label: "0.25%", shadowClip: 0.25, highlightClip: 0.25 },
  { id: "0.5", label: "0.5%", shadowClip: 0.5, highlightClip: 0.5 },
  { id: "1", label: "1%", shadowClip: 1, highlightClip: 1 },
  { id: "2", label: "2%", shadowClip: 2, highlightClip: 2 }
] as const;

export const autoToneRenderer: OpRenderer<AutoToneParams> = {
  type: "auto-tone",
  Card({ params, disabled, onParamsChange }) {
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>Clip shadows</span>
          <input
            disabled={disabled}
            max={10}
            min={0}
            step={0.05}
            type="range"
            value={params.shadowClip}
            onChange={(e) => onParamsChange({ shadowClip: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatPercent(params.shadowClip)}</span>
        </label>
        <label className="slider-row">
          <span>Clip highlights</span>
          <input
            disabled={disabled}
            max={10}
            min={0}
            step={0.05}
            type="range"
            value={params.highlightClip}
            onChange={(e) => onParamsChange({ highlightClip: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatPercent(params.highlightClip)}</span>
        </label>
        <div className="geometry-chip-group" role="group" aria-label="Apply the same clip to shadows and highlights">
          {autoTonePresets.map((preset) => (
            <button
              className={`toolbar-button compact-text ${params.shadowClip === preset.shadowClip && params.highlightClip === preset.highlightClip ? "active" : ""}`}
              disabled={disabled}
              key={preset.id}
              type="button"
              onClick={() => onParamsChange({ shadowClip: preset.shadowClip, highlightClip: preset.highlightClip })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
};

function formatPercent(value: number): string {
  if (Number.isInteger(value)) return `${value}%`;
  const fixed = value < 0.1 ? value.toFixed(2) : value < 1 ? value.toFixed(2) : value.toFixed(1);
  return `${fixed.replace(/\.?0+$/, "")}%`;
}
