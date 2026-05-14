import React from "react";
import { Text } from "react-konva";
import type { OpRenderer } from "./op-renderer";
import { AnchorPicker, type Anchor } from "./_anchor-picker";
import { anchorCanvasPos } from "./_overlay-primitives";

type WatermarkTextParams = {
  text: string;
  anchor: Anchor;
  marginX: number;
  marginY: number;
  opacity: number;
  font: string;
  size: number;
  color: string;
};

export const watermarkTextRenderer: OpRenderer<WatermarkTextParams> = {
  type: "watermark-text",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Text
          <input disabled={disabled} type="text" value={params.text} onChange={(e) => onParamChange("text", e.currentTarget.value)} />
        </label>
        <label className="span-two">
          Size — <strong>{params.size.toFixed(3)}</strong>
          <input disabled={disabled} max={0.2} min={0.005} step={0.005} type="range" value={params.size} onChange={(e) => onParamChange("size", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity — <strong>{params.opacity.toFixed(2)}</strong>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.opacity} onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)} />
        </label>
        <label>
          Color
          <input disabled={disabled} type="color" value={params.color} onChange={(e) => onParamChange("color", e.currentTarget.value)} />
        </label>
        <div className="stacked-field">
          Position
          <AnchorPicker disabled={disabled} value={params.anchor} onChange={(anchor) => onParamChange("anchor", anchor)} />
        </div>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    if (!selected || !params.text.trim()) return null;
    const pos = anchorCanvasPos(params.anchor, ctx.imageSize, ctx.longEdge, ctx.placement, params.marginX, params.marginY, 120, 16);
    return (
      <Text
        draggable
        fill="#ffffff"
        fontSize={13}
        opacity={0.85}
        stroke="#00000080"
        strokeWidth={0.5}
        text={params.text}
        x={pos.x}
        y={pos.y}
        onDragEnd={(event) => {
          const imgX = (event.target.x() - ctx.placement.x) / ctx.placement.scale;
          const imgY = (event.target.y() - ctx.placement.y) / ctx.placement.scale;
          onParamsChange({
            anchor: "top-left",
            marginX: Math.max(0, imgX) / ctx.longEdge,
            marginY: Math.max(0, imgY) / ctx.longEdge
          });
        }}
      />
    );
  }
};
