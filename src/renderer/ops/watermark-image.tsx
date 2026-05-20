import React, { useEffect, useMemo, useState } from "react";
import { api } from "@renderer/ipc/client";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction, sliderLongEdge } from "./_slider-units";

type WatermarkImageParams = {
  pngPath: string;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

const MIN_IMAGE_WATERMARK_SCALE = 0.01;

export const watermarkImageRenderer: OpRenderer<WatermarkImageParams> = {
  type: "watermark-image",
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const image = useLocalImage(params.pngPath);
    const longEdge = sliderLongEdge(ctx.originalSize);
    const imageBounds = ctx.originalSize
      ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
      : { maxX: 1, maxY: 1 };
    const aspectRatio = useMemo(() => {
      if (!image) return 1.5;
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      return width / Math.max(1, height);
    }, [image]);
    const normalizedWatermark = normalizeImageWatermark(params, imageBounds, aspectRatio, MIN_IMAGE_WATERMARK_SCALE);
    const minWidth = fractionToPercentSteps(MIN_IMAGE_WATERMARK_SCALE);
    const widthMax = fractionToPercentSteps(maxImageWatermarkScale(imageBounds, aspectRatio));
    const xMax = fractionToPercentSteps(imageBounds.maxX);
    const yMax = fractionToPercentSteps(imageBounds.maxY);

    function updateGeometry(updates: Partial<WatermarkImageParams>): void {
      onParamsChange(updateImageWatermark(normalizedWatermark, updates, imageBounds, aspectRatio, MIN_IMAGE_WATERMARK_SCALE));
    }

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
          <span>Width</span>
          <input
            disabled={disabled}
            max={widthMax}
            min={minWidth}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedWatermark.scale)}
            onChange={(event) => updateGeometry({ scale: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedWatermark.scale)}</span>
        </label>
        <label className="slider-row">
          <span>X</span>
          <input
            disabled={disabled}
            max={xMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedWatermark.x)}
            onChange={(event) => updateGeometry({ x: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedWatermark.x)}</span>
        </label>
        <label className="slider-row">
          <span>Y</span>
          <input
            disabled={disabled}
            max={yMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedWatermark.y)}
            onChange={(event) => updateGeometry({ y: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedWatermark.y)}</span>
        </label>
        <AngleControl disabled={disabled} value={normalizedWatermark.rotation} onChange={(rotation) => onParamChange("rotation", normalizeAngle(rotation))} />
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={normalizedWatermark.opacity} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(normalizedWatermark.opacity * 100)}%`}</span>
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
    const normalizedWatermark = normalizeImageWatermark(params, ctx.imageBounds, aspectRatio, MIN_IMAGE_WATERMARK_SCALE);
    const stageRect = imageWatermarkToStageRect(normalizedWatermark, ctx, aspectRatio);
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
  ctx: { longEdge: number; imageBounds: { maxX: number; maxY: number }; placement: { x: number; y: number; scale: number } },
  aspectRatio: number
): Partial<WatermarkImageParams> {
  const width = rect.w / ctx.placement.scale;
  return normalizeImageWatermark({
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    scale: clamp(width / ctx.longEdge, MIN_IMAGE_WATERMARK_SCALE, 1),
    rotation: normalizeRotation(rect.rotation ?? 0)
  }, ctx.imageBounds, aspectRatio, 12 / ctx.longEdge);
}

function normalizeImageWatermark<T extends Partial<WatermarkImageParams>>(
  params: T,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number,
  minScale: number
): T {
  const maxScale = maxImageWatermarkScale(bounds, aspectRatio);
  const scale = clamp(params.scale ?? 0.15, Math.min(minScale, maxScale), Math.max(minScale, maxScale));
  const height = scale / Math.max(0.01, aspectRatio);
  return {
    ...params,
    scale,
    x: clamp(params.x ?? 0, 0, Math.max(0, bounds.maxX - scale)),
    y: clamp(params.y ?? 0, 0, Math.max(0, bounds.maxY - height))
  };
}

function updateImageWatermark(
  currentWatermark: WatermarkImageParams,
  updates: Partial<WatermarkImageParams>,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number,
  minScale: number
): WatermarkImageParams {
  const normalizedWatermark = normalizeImageWatermark(currentWatermark, bounds, aspectRatio, minScale);
  let x = normalizedWatermark.x;
  let y = normalizedWatermark.y;
  let scale = normalizedWatermark.scale;

  if (updates.x !== undefined) {
    x = clamp(updates.x, 0, Math.max(0, bounds.maxX - scale));
  }
  if (updates.y !== undefined) {
    const height = scale / Math.max(0.01, aspectRatio);
    y = clamp(updates.y, 0, Math.max(0, bounds.maxY - height));
  }
  if (updates.scale !== undefined) {
    scale = clamp(updates.scale, minScale, maxImageWatermarkScaleAtPosition(bounds, aspectRatio, x, y, minScale));
    y = clamp(y, 0, Math.max(0, bounds.maxY - scale / Math.max(0.01, aspectRatio)));
  } else {
    scale = clamp(scale, minScale, maxImageWatermarkScaleAtPosition(bounds, aspectRatio, x, y, minScale));
  }

  return {
    ...normalizedWatermark,
    ...updates,
    x,
    y,
    scale
  };
}

function maxImageWatermarkScale(bounds: { maxX: number; maxY: number }, aspectRatio: number): number {
  return Math.max(0.01, Math.min(bounds.maxX, bounds.maxY * Math.max(0.01, aspectRatio)));
}

function maxImageWatermarkScaleAtPosition(
  bounds: { maxX: number; maxY: number },
  aspectRatio: number,
  x: number,
  y: number,
  minScale: number
): number {
  return Math.max(
    minScale,
    Math.min(
      Math.max(minScale, bounds.maxX - x),
      Math.max(minScale, (bounds.maxY - y) * Math.max(0.01, aspectRatio))
    )
  );
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
  return normalizeAngle(rotation);
}
