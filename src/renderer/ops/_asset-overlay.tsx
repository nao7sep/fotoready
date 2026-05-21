import React, { useEffect, useMemo, useState } from "react";
import {
  MIN_ASSET_OVERLAY_WIDTH,
  assetOverlayHeight,
  maxAssetOverlayWidth,
  normalizeAssetAspectRatio,
  normalizeAssetOverlay,
  updateAssetOverlay,
  type AssetOverlayParams
} from "@shared/asset-overlay";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction, sliderLongEdge } from "./_slider-units";
import type { OpCardContext, OverlayContext } from "./op-renderer";

export function AssetOverlayControls({
  aspectRatio,
  ctx,
  disabled,
  onParamChange,
  onParamsChange,
  params,
  sourceControl
}: {
  aspectRatio: number;
  ctx: OpCardContext;
  disabled: boolean;
  onParamChange<K extends keyof AssetOverlayParams>(key: K, value: AssetOverlayParams[K]): void;
  onParamsChange(patch: Partial<AssetOverlayParams>): void;
  params: AssetOverlayParams;
  sourceControl: React.ReactNode;
}): React.JSX.Element {
  const longEdge = sliderLongEdge(ctx.originalSize);
  const imageBounds = ctx.originalSize
    ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
    : { maxX: 1, maxY: 1 };
  const normalizedOverlay = useMemo(
    () => normalizeAssetOverlay(params, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_WIDTH),
    [aspectRatio, imageBounds.maxX, imageBounds.maxY, params]
  );

  useEffect(() => {
    if (!params.assetPath || !ctx.originalSize) return;
    if (sameGeometry(params, normalizedOverlay)) return;
    onParamsChange({
      x: normalizedOverlay.x,
      y: normalizedOverlay.y,
      width: normalizedOverlay.width
    });
  }, [ctx.originalSize, normalizedOverlay, onParamsChange, params]);

  const minWidth = fractionToPercentSteps(MIN_ASSET_OVERLAY_WIDTH);
  const widthMax = fractionToPercentSteps(maxAssetOverlayWidth(imageBounds, aspectRatio));
  const xMax = fractionToPercentSteps(imageBounds.maxX);
  const yMax = fractionToPercentSteps(imageBounds.maxY);

  function updateGeometry(updates: Partial<AssetOverlayParams>): void {
    onParamsChange(updateAssetOverlay(normalizedOverlay, updates, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_WIDTH));
  }

  return (
    <div className="geometry-controls">
      {sourceControl}
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={widthMax}
          min={minWidth}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.width)}
          onChange={(event) => updateGeometry({ width: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.width)}</span>
      </label>
      <label className="slider-row">
        <span>X</span>
        <input
          disabled={disabled}
          max={xMax}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.x)}
          onChange={(event) => updateGeometry({ x: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.x)}</span>
      </label>
      <label className="slider-row">
        <span>Y</span>
        <input
          disabled={disabled}
          max={yMax}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.y)}
          onChange={(event) => updateGeometry({ y: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.y)}</span>
      </label>
      <AngleControl disabled={disabled} value={normalizedOverlay.rotation} onChange={(rotation) => onParamChange("rotation", normalizeAngle(rotation))} />
      <label className="slider-row">
        <span>Opacity</span>
        <input
          disabled={disabled}
          max={1}
          min={0}
          step={0.01}
          type="range"
          value={normalizedOverlay.opacity}
          onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)}
        />
        <span className="slider-value">{`${Math.round(normalizedOverlay.opacity * 100)}%`}</span>
      </label>
      <div className="row-detail">Height follows the asset: {formatPercent(assetOverlayHeight(normalizedOverlay.width, aspectRatio))}</div>
    </div>
  );
}

export function AssetOverlayRect({
  aspectRatio,
  color,
  ctx,
  onParamsChange,
  params,
  selected
}: {
  aspectRatio: number;
  color: string;
  ctx: OverlayContext;
  onParamsChange(patch: Partial<AssetOverlayParams>): void;
  params: AssetOverlayParams;
  selected: boolean;
}): React.JSX.Element | null {
  if (!selected || !params.assetPath) return null;
  const normalizedOverlay = normalizeAssetOverlay(params, ctx.imageBounds, aspectRatio, MIN_ASSET_OVERLAY_WIDTH);
  const stageRect = assetOverlayToStageRect(normalizedOverlay, ctx, aspectRatio);
  return (
    <InteractiveOverlayRect
      aspectRatio={aspectRatio}
      color={color}
      placement={ctx.placement}
      rect={stageRect}
      rotateEnabled
      onChange={() => undefined}
      onCommit={(next) => onParamsChange(stageRectToAssetOverlay(next, ctx, aspectRatio))}
    />
  );
}

export function useLocalAssetAspectRatio(assetPath: string): number {
  const image = useLocalAssetImage(assetPath);
  return useMemo(() => {
    if (!image) return normalizeAssetAspectRatio(null);
    return normalizeAssetAspectRatio((image.naturalWidth || image.width || 1) / Math.max(1, image.naturalHeight || image.height || 1));
  }, [image]);
}

export async function normalizeAssetOverlayForPath(
  params: AssetOverlayParams,
  originalSize: { width: number; height: number } | null,
  nextAssetPath: string
): Promise<Partial<AssetOverlayParams>> {
  const aspectRatio = await readLocalAssetAspectRatio(nextAssetPath);
  const longEdge = sliderLongEdge(originalSize);
  const imageBounds = originalSize
    ? { maxX: originalSize.width / longEdge, maxY: originalSize.height / longEdge }
    : { maxX: 1, maxY: 1 };
  const normalized = normalizeAssetOverlay({ ...params, assetPath: nextAssetPath }, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_WIDTH);
  return {
    assetPath: nextAssetPath,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width
  };
}

function assetOverlayToStageRect(
  params: AssetOverlayParams,
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } },
  aspectRatio: number
): { x: number; y: number; w: number; h: number; rotation: number } {
  const width = params.width * ctx.longEdge;
  const height = assetOverlayHeight(params.width, aspectRatio) * ctx.longEdge;
  return {
    x: ctx.placement.x + params.x * ctx.longEdge * ctx.placement.scale,
    y: ctx.placement.y + params.y * ctx.longEdge * ctx.placement.scale,
    w: width * ctx.placement.scale,
    h: height * ctx.placement.scale,
    rotation: params.rotation
  };
}

function stageRectToAssetOverlay(
  rect: { x: number; y: number; w: number; h: number; rotation?: number },
  ctx: { longEdge: number; imageBounds: { maxX: number; maxY: number }; placement: { x: number; y: number; scale: number } },
  aspectRatio: number
): Partial<AssetOverlayParams> {
  const width = rect.w / (ctx.placement.scale * ctx.longEdge);
  const normalized = normalizeAssetOverlay({
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    width,
    rotation: normalizeAngle(rect.rotation ?? 0)
  }, ctx.imageBounds, aspectRatio, MIN_ASSET_OVERLAY_WIDTH);
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    rotation: normalized.rotation
  };
}

function useLocalAssetImage(assetPath: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!assetPath) {
      setImage(null);
      return;
    }
    const next = new window.Image();
    next.onload = () => setImage(next);
    next.onerror = () => setImage(null);
    next.src = fileUrl(assetPath);
    return () => {
      next.onload = null;
      next.onerror = null;
    };
  }, [assetPath]);
  return image;
}

async function readLocalAssetAspectRatio(assetPath: string): Promise<number> {
  if (!assetPath) return normalizeAssetAspectRatio(null);
  return new Promise((resolve) => {
    const next = new window.Image();
    next.onload = () => resolve(normalizeAssetAspectRatio((next.naturalWidth || next.width || 1) / Math.max(1, next.naturalHeight || next.height || 1)));
    next.onerror = () => resolve(normalizeAssetAspectRatio(null));
    next.src = fileUrl(assetPath);
  });
}

function sameGeometry(left: AssetOverlayParams, right: AssetOverlayParams): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y) && nearlyEqual(left.width, right.width);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function fileUrl(assetPath: string): string {
  const normalized = assetPath.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return encodeURI(`file://${absolute}`).replaceAll("#", "%23");
}
