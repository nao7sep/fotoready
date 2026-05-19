import React from "react";
import { WATERMARK_TEXT_BOX_HEIGHT_EM, estimateWatermarkTextLayout } from "@shared/watermark-text-layout";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";

type WatermarkTextParams = {
  text: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  size: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  bold: boolean;
  italic: boolean;
};

export const watermarkTextRenderer: OpRenderer<WatermarkTextParams> = {
  type: "watermark-text",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="geometry-controls">
        <input
          className="compact-control"
          disabled={disabled}
          type="text"
          value={params.text}
          onChange={(event) => onParamChange("text", event.currentTarget.value)}
        />
        <div className="watermark-style-row">
          <button className={`toolbar-button compact-text ${params.bold ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("bold", !params.bold)}>Bold</button>
          <button className={`toolbar-button compact-text ${params.italic ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("italic", !params.italic)}>Italic</button>
        </div>
        <label className="slider-row">
          <span>Size</span>
          <input disabled={disabled} max={0.2} min={0.005} step={0.005} type="range" value={params.size} onChange={(event) => onParamChange("size", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.size.toFixed(3)}</span>
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.opacity} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
        <label className="control-row">
          <span>Text color</span>
          <input disabled={disabled} type="color" value={params.color} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
        <label className="control-row">
          <span>Background</span>
          <input disabled={disabled} type="color" value={params.backgroundColor} onChange={(event) => onParamChange("backgroundColor", event.currentTarget.value)} />
        </label>
        <label className="slider-row">
          <span>Background opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.backgroundOpacity} onChange={(event) => onParamChange("backgroundOpacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.backgroundOpacity * 100)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    if (!selected || !params.text.trim()) return null;
    const stageRect = textWatermarkToStageRect(params, ctx);
    return (
      <InteractiveOverlayRect
        aspectRatio={stageRect.w / Math.max(1, stageRect.h)}
        color="#a78bfa"
        placement={ctx.placement}
        rect={stageRect}
        rotateEnabled
        onChange={() => undefined}
        onCommit={(next) => onParamsChange(stageRectToTextWatermark(next, ctx))}
      />
    );
  }
};

function textWatermarkToStageRect(
  params: WatermarkTextParams,
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } }
): { x: number; y: number; w: number; h: number; rotation: number } {
  const fontSize = Math.max(8, Math.round(params.size * ctx.longEdge));
  const layout = estimateWatermarkTextLayout(params.text, fontSize, params.bold, params.italic);
  return {
    x: ctx.placement.x + params.x * ctx.longEdge * ctx.placement.scale,
    y: ctx.placement.y + params.y * ctx.longEdge * ctx.placement.scale,
    w: layout.width * ctx.placement.scale,
    h: layout.height * ctx.placement.scale,
    rotation: params.rotation
  };
}

function stageRectToTextWatermark(
  rect: { x: number; y: number; w: number; h: number; rotation?: number },
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } }
): Partial<WatermarkTextParams> {
  const size = rect.h / (ctx.longEdge * ctx.placement.scale * WATERMARK_TEXT_BOX_HEIGHT_EM);
  return {
    x: clamp((rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale), 0, 1),
    y: clamp((rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale), 0, 1),
    size: clamp(size, 0.005, 1),
    rotation: normalizeRotation(rect.rotation ?? 0)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}
