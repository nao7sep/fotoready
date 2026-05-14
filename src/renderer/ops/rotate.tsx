import React from "react";
import { Line, Rect } from "react-konva";
import type { OpRenderer } from "./op-renderer";

type RotateParams = { degrees: number; fillColor: string };

const rotateFillSwatches = ["#ffffff", "#000000", "#f5f5f5", "#e5e7eb", "#dbeafe"] as const;

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
                aria-label={`Use fill color ${swatch}`}
                className={`color-swatch ${params.fillColor.toLowerCase() === swatch ? "active" : ""}`}
                disabled={disabled}
                key={swatch}
                style={{ background: swatch }}
                type="button"
                onClick={() => onParamChange("fillColor", swatch)}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={params.fillColor} onChange={(e) => onParamChange("fillColor", e.currentTarget.value)} />
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
