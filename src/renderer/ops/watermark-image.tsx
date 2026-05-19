import React, { useEffect, useMemo, useState } from "react";
import { api } from "@renderer/ipc/client";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";

type WatermarkImageParams = {
  pngPath: string;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

export const watermarkImageRenderer: OpRenderer<WatermarkImageParams> = {
  type: "watermark-image",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="geometry-controls">
        <div className="watermark-file-row">
          <input
            className="compact-control"
            disabled={disabled}
            placeholder="PNG file"
            type="text"
            value={params.pngPath}
            onChange={(event) => onParamChange("pngPath", event.currentTarget.value)}
          />
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={async () => {
            const picked = await api.system.pickFile({ title: "Choose PNG file", extensions: ["png"] });
            if (picked) onParamChange("pngPath", picked);
          }}>
            Choose PNG...
          </button>
        </div>
        <label className="slider-row">
          <span>Scale</span>
          <input disabled={disabled} max={0.5} min={0.01} step={0.01} type="range" value={params.scale} onChange={(event) => onParamChange("scale", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.scale * 100)}%`}</span>
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.05} type="range" value={params.opacity} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    const image = useLocalImage(params.pngPath);
    const aspectRatio = useMemo(() => {
      if (!image) return 1.5;
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      return width / Math.max(1, height);
    }, [image]);
    if (!selected || !params.pngPath) return null;
    const stageRect = imageWatermarkToStageRect(params, ctx, aspectRatio);
    return (
      <InteractiveOverlayRect
        aspectRatio={aspectRatio}
        color="#60a5fa"
        placement={ctx.placement}
        rect={stageRect}
        rotateEnabled
        onChange={() => undefined}
        onCommit={(next) => onParamsChange(stageRectToImageWatermark(next, ctx, aspectRatio))}
      />
    );
  }
};

function imageWatermarkToStageRect(
  params: WatermarkImageParams,
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } },
  aspectRatio: number
): { x: number; y: number; w: number; h: number; rotation: number } {
  const width = params.scale * ctx.longEdge;
  const height = width / Math.max(0.01, aspectRatio);
  return {
    x: ctx.placement.x + params.x * ctx.longEdge * ctx.placement.scale,
    y: ctx.placement.y + params.y * ctx.longEdge * ctx.placement.scale,
    w: width * ctx.placement.scale,
    h: height * ctx.placement.scale,
    rotation: params.rotation
  };
}

function stageRectToImageWatermark(
  rect: { x: number; y: number; w: number; h: number; rotation?: number },
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } },
  aspectRatio: number
): Partial<WatermarkImageParams> {
  const width = rect.w / ctx.placement.scale;
  return {
    x: clamp((rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale), 0, 1),
    y: clamp((rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale), 0, 1),
    scale: clamp(width / ctx.longEdge, 0.01, 1),
    rotation: normalizeRotation(rect.rotation ?? 0)
  };
}

function useLocalImage(path: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!path) {
      setImage(null);
      return;
    }
    const next = new window.Image();
    next.onload = () => setImage(next);
    next.onerror = () => setImage(null);
    next.src = fileUrl(path);
    return () => {
      next.onload = null;
      next.onerror = null;
    };
  }, [path]);
  return image;
}

function fileUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return encodeURI(`file://${absolute}`).replaceAll("#", "%23");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}
