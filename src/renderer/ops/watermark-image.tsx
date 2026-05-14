import React from "react";
import { Rect } from "react-konva";
import { api } from "@renderer/ipc/client";
import type { OpRenderer } from "./op-renderer";
import { AnchorPicker, type Anchor } from "./_anchor-picker";
import { anchorCanvasPos } from "./_overlay-primitives";

type WatermarkImageParams = {
  pngPath: string;
  anchor: Anchor;
  marginX: number;
  marginY: number;
  opacity: number;
  scale: number;
};

export const watermarkImageRenderer: OpRenderer<WatermarkImageParams> = {
  type: "watermark-image",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          PNG path
          <input disabled={disabled} type="text" value={params.pngPath} onChange={(e) => onParamChange("pngPath", e.currentTarget.value)} />
        </label>
        <button className="toolbar-button span-two" disabled={disabled} type="button" onClick={async () => {
          const picked = await api.system.pickFile({ title: "Choose Watermark PNG", extensions: ["png"] });
          if (picked) onParamChange("pngPath", picked);
        }}>Browse PNG...</button>
        <label className="span-two">
          Scale — <strong>{params.scale.toFixed(2)}</strong>
          <input disabled={disabled} max={0.5} min={0.01} step={0.01} type="range" value={params.scale} onChange={(e) => onParamChange("scale", e.currentTarget.valueAsNumber)} />
        </label>
        <label className="span-two">
          Opacity — <strong>{params.opacity.toFixed(2)}</strong>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.opacity} onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)} />
        </label>
        <div className="stacked-field span-two">
          Position
          <AnchorPicker disabled={disabled} value={params.anchor} onChange={(anchor) => onParamChange("anchor", anchor)} />
        </div>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    if (!selected) return null;
    const approxW = ctx.longEdge * params.scale * ctx.placement.scale;
    const pos = anchorCanvasPos(params.anchor, ctx.imageSize, ctx.longEdge, ctx.placement, params.marginX, params.marginY, ctx.longEdge * params.scale, ctx.longEdge * params.scale * 0.6);
    return (
      <Rect
        draggable
        fill="#ffffff30"
        height={approxW * 0.6}
        stroke="#ffffffaa"
        strokeWidth={1}
        width={approxW}
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
