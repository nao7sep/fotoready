import React from "react";
import { Line, Rect } from "react-konva";
import type { OpRenderer } from "./op-renderer";

type RotateParams = { degrees: number; fillColor: string };

const rotateFillSwatches = [
  { value: "rgba(0,0,0,0)", label: "Transparent", style: { background: "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%), linear-gradient(45deg, #d1d5db 25%, #ffffff 25%, #ffffff 75%, #d1d5db 75%)", backgroundPosition: "0 0, 6px 6px", backgroundSize: "12px 12px" } },
  { value: "#ffffff", label: "White", style: { background: "#ffffff" } },
  { value: "#000000", label: "Black", style: { background: "#000000" } },
  { value: "#00ff66", label: "Key green", style: { background: "#00ff66" } },
  { value: "#0088ff", label: "Key blue", style: { background: "#0088ff" } }
] as const;

export const rotateRenderer: OpRenderer<RotateParams> = {
  type: "rotate",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <div className="geometry-stepper-group">
            <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", normalizeDegrees(params.degrees - 90))}>-90°</button>
            <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", normalizeDegrees(params.degrees + 90))}>+90°</button>
            <button className="inline-action" disabled={disabled} type="button" onClick={() => onParamChange("degrees", 0)}>Reset</button>
          </div>
          <span className="geometry-status">Angle: <strong>{formatDegrees(params.degrees)}</strong></span>
        </div>
        <label className="stacked-field geometry-range-field">
          Rotate left / right
          <input disabled={disabled} max={180} min={-180} step={1} type="range" value={params.degrees} onChange={(e) => onParamChange("degrees", e.currentTarget.valueAsNumber)} />
        </label>
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Fill</span>
          <div className="geometry-swatch-group" role="group" aria-label="Rotate fill color">
            {rotateFillSwatches.map((swatch) => (
              <button
                aria-label={`Use ${swatch.label.toLowerCase()} fill`}
                className={`color-swatch ${normalizeFillColor(params.fillColor) === normalizeFillColor(swatch.value) ? "active" : ""}${swatch.value === "rgba(0,0,0,0)" ? " transparent" : ""}`}
                disabled={disabled}
                key={swatch.value}
                style={swatch.style}
                type="button"
                onClick={() => onParamChange("fillColor", swatch.value)}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={colorPickerValue(params.fillColor)} onChange={(e) => onParamChange("fillColor", e.currentTarget.value)} />
            </label>
          </div>
        </div>
      </div>
    );
  },
  Overlay({ selected, ctx }) {
    if (!selected) return null;
    const { placement } = ctx;
    return (
      <>
        <Rect height={placement.height} stroke="#ffffffaa" strokeWidth={1} width={placement.width} x={placement.x} y={placement.y} />
        <Line dash={[8, 8]} stroke="#ffffffaa" strokeWidth={1} points={[placement.x + placement.width / 2, placement.y, placement.x + placement.width / 2, placement.y + placement.height]} />
        <Line dash={[8, 8]} stroke="#ffffffaa" strokeWidth={1} points={[placement.x, placement.y + placement.height / 2, placement.x + placement.width, placement.y + placement.height / 2]} />
      </>
    );
  }
};

function normalizeDegrees(value: number): number {
  let next = Math.round(value);
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}

function formatDegrees(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value)}°`;
}

function normalizeFillColor(value: string): string {
  return value.trim().toLowerCase();
}

function colorPickerValue(value: string): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value : "#ffffff";
}
