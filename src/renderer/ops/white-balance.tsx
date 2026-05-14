import React from "react";
import { Circle } from "react-konva";
import type { OpRenderer } from "./op-renderer";

type WhiteBalanceParams = {
  temperature: number;
  tint: number;
  samplePoint: [number, number] | null;
};

export const whiteBalanceRenderer: OpRenderer<WhiteBalanceParams> = {
  type: "white-balance",
  consumesImageClick: true,
  Card({ params, disabled, onParamChange }) {
    const samplePoint = params.samplePoint;
    return (
      <div className="field-grid">
        <label className="span-two">
          Temperature — <strong>{params.temperature}</strong>
          <input disabled={disabled || samplePoint !== null} max={100} min={-100} step={1} type="range" value={params.temperature} onChange={(e) => onParamChange("temperature", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Tint — <strong>{params.tint}</strong>
          <input disabled={disabled || samplePoint !== null} max={100} min={-100} step={1} type="range" value={params.tint} onChange={(e) => onParamChange("tint", e.currentTarget.valueAsNumber)} />
        </label>
        <div className="row-detail span-two">
          {samplePoint
            ? `Preview sample active at ${samplePoint[0].toFixed(3)}, ${samplePoint[1].toFixed(3)}.`
            : "Click the preview while this op is selected to sample a neutral point."}
        </div>
        {samplePoint ? (
          <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={() => onParamChange("samplePoint", null)}>
            Use temperature/tint sliders
          </button>
        ) : null}
      </div>
    );
  },
  Overlay({ params, selected, ctx }) {
    if (!selected || !params.samplePoint) return null;
    return (
      <Circle
        fill="#60a5fa"
        opacity={0.9}
        radius={5}
        stroke="#ffffff"
        strokeWidth={2}
        x={ctx.placement.x + params.samplePoint[0] * ctx.longEdge * ctx.placement.scale}
        y={ctx.placement.y + params.samplePoint[1] * ctx.longEdge * ctx.placement.scale}
      />
    );
  },
  onImageClick(localX, localY, _params, ctx, onParamsChange) {
    const longEdge = ctx.longEdge;
    onParamsChange({
      samplePoint: [
        clamp(localX / longEdge, 0, ctx.imageSize.width / longEdge),
        clamp(localY / longEdge, 0, ctx.imageSize.height / longEdge)
      ]
    });
  }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
