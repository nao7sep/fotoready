import React from "react";
import type { OpRenderer } from "./op-renderer";

type HslAdjustment = { hue: number; sat: number; lum: number };
type HslParams = Record<HslRange, HslAdjustment>;
const HSL_RANGES = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
type HslRange = (typeof HSL_RANGES)[number];

export const hslRenderer: OpRenderer<HslParams> = {
  type: "hsl",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="hsl-grid">
        {HSL_RANGES.map((range) => {
          const adjustment = params[range] ?? { hue: 0, sat: 0, lum: 0 };
          return (
            <div className="hsl-row" key={range}>
              <span>{range}</span>
              {(["hue", "sat", "lum"] as const).map((key) => (
                <label key={key}>
                  {key} <strong>{key === "hue" ? Math.round(adjustment[key]) : adjustment[key].toFixed(2)}</strong>
                  <input
                    disabled={disabled}
                    max={key === "hue" ? 180 : 1}
                    min={key === "hue" ? -180 : -1}
                    step={key === "hue" ? 1 : 0.01}
                    type="range"
                    value={adjustment[key]}
                    onChange={(e) => onParamChange(range, { ...adjustment, [key]: e.currentTarget.valueAsNumber } as never)}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
    );
  }
};
