import React from "react";
import { Line, Rect } from "react-konva";
import type { OpRenderer } from "./op-renderer";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";

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
        <AngleControl disabled={disabled} rangeLabel="Rotate left / right" value={params.degrees} onChange={(degrees) => onParamChange("degrees", normalizeAngle(degrees))} />
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Fill</span>
          <div className="geometry-swatch-group">
            <SegmentedRadioGroup
              className="geometry-swatch-group"
              optionClassName="color-swatch"
              ariaLabel="Rotate fill color"
              options={rotateFillSwatches.map((swatch) => ({
                id: swatch.value,
                ariaLabel: `Use ${swatch.label.toLowerCase()} fill`,
                style: swatch.style,
                className: swatch.value === "rgba(0,0,0,0)" ? "transparent" : undefined,
              }))}
              value={
                rotateFillSwatches.find(
                  (swatch) =>
                    normalizeFillColor(params.fillColor) === normalizeFillColor(swatch.value),
                )?.value ?? null
              }
              onChange={(value) => onParamChange("fillColor", value)}
              disabled={disabled}
            />
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

function normalizeFillColor(value: string): string {
  return value.trim().toLowerCase();
}

function colorPickerValue(value: string): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value : "#ffffff";
}
