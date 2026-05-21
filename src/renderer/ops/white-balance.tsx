import React from "react";
import { Circle } from "react-konva";
import { clamp } from "@shared/numeric";
import type { OpRenderer } from "./op-renderer";

type WhiteBalanceParams = {
  temperature: number;
  tint: number;
  samplePoint: [number, number] | null;
};

export const whiteBalanceRenderer: OpRenderer<WhiteBalanceParams> = {
  type: "white-balance",
  consumesImageClick: true,
  Card({ params, disabled, onParamsChange }) {
    const samplePoint = params.samplePoint;
    return (
      <div className="geometry-controls">
        <div className="row-detail">Temperature: blue to amber. Tint: green to magenta.</div>
        <label className="slider-row">
          <span>Temperature</span>
          <input
            disabled={disabled}
            max={100}
            min={-100}
            step={1}
            type="range"
            value={params.temperature}
            onChange={(e) => onParamsChange({ samplePoint: null, temperature: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatSigned(params.temperature)}</span>
        </label>
        <label className="slider-row">
          <span>Tint</span>
          <input
            disabled={disabled}
            max={100}
            min={-100}
            step={1}
            type="range"
            value={params.tint}
            onChange={(e) => onParamsChange({ samplePoint: null, tint: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatSigned(params.tint)}</span>
        </label>
        <div className="geometry-toolbar-row">
          <span className="geometry-status">
            {samplePoint
              ? `Sample active at ${samplePoint[0].toFixed(3)}, ${samplePoint[1].toFixed(3)}. Move either slider to fine-tune.`
              : "Click the preview while this op is selected to sample a neutral point."}
          </span>
        </div>
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
  onImageClick(localX, localY, params, ctx, onParamsChange) {
    const sampled = ctx.samplePixel(localX, localY);
    if (!sampled) return;
    const source = invertCurrentWhiteBalance(sampled, params);
    const next = deriveWhiteBalanceFromSample(source);
    const longEdge = ctx.longEdge;
    onParamsChange({
      temperature: next.temperature,
      tint: next.tint,
      samplePoint: [
        clamp(localX / longEdge, 0, ctx.imageSize.width / longEdge),
        clamp(localY / longEdge, 0, ctx.imageSize.height / longEdge)
      ]
    });
  }
};

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function invertCurrentWhiteBalance(
  sampled: { r: number; g: number; b: number },
  params: WhiteBalanceParams
): { r: number; g: number; b: number } {
  const redGain = 1 + params.temperature / 500;
  const greenGain = 1 + params.tint / 700;
  const blueGain = 1 - params.temperature / 500;
  return {
    r: clamp(sampled.r / Math.max(0.01, redGain), 0, 255),
    g: clamp(sampled.g / Math.max(0.01, greenGain), 0, 255),
    b: clamp(sampled.b / Math.max(0.01, blueGain), 0, 255)
  };
}

function deriveWhiteBalanceFromSample(sampled: { r: number; g: number; b: number }): { temperature: number; tint: number } {
  const target = Math.max(1, (sampled.r + sampled.g + sampled.b) / 3);
  const redGain = target / Math.max(1, sampled.r);
  const greenGain = target / Math.max(1, sampled.g);
  const blueGain = target / Math.max(1, sampled.b);
  return {
    temperature: clamp(Math.round((((redGain - 1) + (1 - blueGain)) / 2) * 500), -100, 100),
    tint: clamp(Math.round((greenGain - 1) * 700), -100, 100)
  };
}
