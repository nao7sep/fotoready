import React from "react";
import type { OpRenderer } from "./op-renderer";

type HslAdjustment = { hue: number; sat: number; lum: number };
const HSL_RANGES = [
  { id: "all", label: "All colors", color: "#94a3b8", subtitle: "Global" },
  { id: "red", label: "Red", color: "#ef4444", subtitle: undefined },
  { id: "orange", label: "Orange", color: "#f97316", subtitle: undefined },
  { id: "yellow", label: "Yellow", color: "#eab308", subtitle: undefined },
  { id: "green", label: "Green", color: "#22c55e", subtitle: undefined },
  { id: "aqua", label: "Aqua", color: "#06b6d4", subtitle: undefined },
  { id: "blue", label: "Blue", color: "#3b82f6", subtitle: undefined },
  { id: "purple", label: "Purple", color: "#8b5cf6", subtitle: undefined },
  { id: "magenta", label: "Magenta", color: "#d946ef", subtitle: undefined }
] as const satisfies ReadonlyArray<{ id: "all" | "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta"; label: string; color: string; subtitle?: string }>;
type HslRange = (typeof HSL_RANGES)[number]["id"];
type HslParams = Record<HslRange, HslAdjustment>;

export const hslRenderer: OpRenderer<HslParams> = {
  type: "hsl",
  Card({ params, disabled, onParamsChange }) {
    function setAdjustment(range: HslRange, patch: Partial<HslAdjustment>): void {
      const current = params[range] ?? { hue: 0, sat: 0, lum: 0 };
      onParamsChange({ [range]: { ...current, ...patch } } as Partial<HslParams>);
    }
    return (
      <div className="hsl-panel">
        <div className="hsl-grid">
        {HSL_RANGES.map((range) => {
          const adjustment = params[range.id] ?? { hue: 0, sat: 0, lum: 0 };
          return (
            <section className={`hsl-band ${range.id === "all" ? "all-colors" : ""}`} key={range.id}>
              <div className="hsl-band-header">
                <span className="hsl-band-swatch" style={{ backgroundColor: range.color }} />
                <div className="hsl-band-heading">
                  <strong>{range.label}</strong>
                  <span>{range.subtitle ?? "Hue band"}</span>
                </div>
              </div>
              <div className="hsl-band-sliders">
                <label className="slider-row">
                  <span>Hue</span>
                  <input
                    disabled={disabled}
                    max={180}
                    min={-180}
                    step={1}
                    type="range"
                    value={adjustment.hue}
                    onChange={(e) => setAdjustment(range.id, { hue: e.currentTarget.valueAsNumber })}
                  />
                  <span className="slider-value">{formatSigned(adjustment.hue, "\u00b0")}</span>
                </label>
                <label className="slider-row">
                  <span>Sat</span>
                  <input
                    disabled={disabled}
                    max={100}
                    min={-100}
                    step={1}
                    type="range"
                    value={Math.round(adjustment.sat * 100)}
                    onChange={(e) => setAdjustment(range.id, { sat: e.currentTarget.valueAsNumber / 100 })}
                  />
                  <span className="slider-value">{formatSigned(Math.round(adjustment.sat * 100), "%")}</span>
                </label>
                <label className="slider-row">
                  <span>Light</span>
                  <input
                    disabled={disabled}
                    max={100}
                    min={-100}
                    step={1}
                    type="range"
                    value={Math.round(adjustment.lum * 100)}
                    onChange={(e) => setAdjustment(range.id, { lum: e.currentTarget.valueAsNumber / 100 })}
                  />
                  <span className="slider-value">{formatSigned(Math.round(adjustment.lum * 100), "%")}</span>
                </label>
              </div>
            </section>
          );
        })}
        </div>
      </div>
    );
  }
};

function formatSigned(value: number, suffix: string): string {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}
