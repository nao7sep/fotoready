import React, { useEffect, useMemo, useState } from "react";
import {
  MIN_ASSET_OVERLAY_SIZE,
  maxAssetOverlayHeightAtPosition,
  maxAssetOverlayWidthAtPosition,
  normalizeAssetAspectRatio,
  normalizeAssetOverlay,
  updateAssetOverlay,
  type AssetOverlayParams
} from "@shared/asset-overlay";
import type { OpRenderer } from "./op-renderer";
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
  sourceAction,
  sourceField
}: {
  aspectRatio: number;
  ctx: OpCardContext;
  disabled: boolean;
  onParamChange<K extends keyof AssetOverlayParams>(key: K, value: AssetOverlayParams[K]): void;
  onParamsChange(patch: Partial<AssetOverlayParams>): void;
  params: AssetOverlayParams;
  sourceAction: React.ReactNode;
  sourceField: React.ReactNode;
}): React.JSX.Element {
  const longEdge = sliderLongEdge(ctx.originalSize);
  const imageBounds = ctx.originalSize
    ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
    : { maxX: 1, maxY: 1 };
  const normalizedOverlay = useMemo(
    () => normalizeAssetOverlay(params, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_SIZE),
    [aspectRatio, imageBounds.maxX, imageBounds.maxY, params]
  );

  useEffect(() => {
    if (!params.assetPath || !ctx.originalSize) return;
    if (sameGeometry(params, normalizedOverlay)) return;
    onParamsChange({
      x: normalizedOverlay.x,
      y: normalizedOverlay.y,
      width: normalizedOverlay.width,
      height: normalizedOverlay.height
    });
  }, [ctx.originalSize, normalizedOverlay, onParamsChange, params]);

  const minWidth = fractionToPercentSteps(MIN_ASSET_OVERLAY_SIZE);
  const minHeight = fractionToPercentSteps(MIN_ASSET_OVERLAY_SIZE);
  const widthMax = fractionToPercentSteps(
    maxAssetOverlayWidthAtPosition(
      imageBounds,
      aspectRatio,
      normalizedOverlay.lockAspectRatio,
      normalizedOverlay.x,
      normalizedOverlay.y,
      MIN_ASSET_OVERLAY_SIZE
    )
  );
  const heightMax = fractionToPercentSteps(
    maxAssetOverlayHeightAtPosition(
      imageBounds,
      aspectRatio,
      normalizedOverlay.lockAspectRatio,
      normalizedOverlay.x,
      normalizedOverlay.y,
      MIN_ASSET_OVERLAY_SIZE
    )
  );
  const xMax = fractionToPercentSteps(imageBounds.maxX);
  const yMax = fractionToPercentSteps(imageBounds.maxY);

  function updateGeometry(updates: Partial<AssetOverlayParams>): void {
    onParamsChange(updateAssetOverlay(normalizedOverlay, updates, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_SIZE));
  }

  return (
    <div className="geometry-controls">
      {sourceField}
      {sourceAction}
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
      <label className="toggle-row">
        <input
          checked={normalizedOverlay.lockAspectRatio}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => updateGeometry({ lockAspectRatio: event.currentTarget.checked })}
        />
        Lock aspect ratio
      </label>
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
        <span>Height</span>
        <input
          disabled={disabled}
          max={heightMax}
          min={minHeight}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.height)}
          onChange={(event) => updateGeometry({ height: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.height)}</span>
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
      <div className="row-detail">
        {normalizedOverlay.lockAspectRatio
          ? `Locked to ${formatPercent(normalizedOverlay.width)} × ${formatPercent(normalizedOverlay.height)}.`
          : `Free size: ${formatPercent(normalizedOverlay.width)} × ${formatPercent(normalizedOverlay.height)}.`}
      </div>
    </div>
  );
}

export function createAssetOverlayRenderer(definition: {
  type: string;
  color: string;
  renderSourceAction(props: AssetOverlayCardProps): React.ReactNode;
  renderSourceField(props: AssetOverlayCardProps): React.ReactNode;
}): OpRenderer<AssetOverlayParams> {
  return {
    type: definition.type,
    Card(props) {
      const aspectRatio = useLocalAssetAspectRatio(props.params.assetPath);
      return (
        <AssetOverlayControls
          aspectRatio={aspectRatio}
          ctx={props.ctx}
          disabled={props.disabled}
          params={props.params}
          onParamChange={props.onParamChange}
          onParamsChange={props.onParamsChange}
          sourceAction={definition.renderSourceAction(props)}
          sourceField={definition.renderSourceField(props)}
        />
      );
    },
    Overlay({ params, selected, ctx, onParamsChange }) {
      const aspectRatio = useLocalAssetAspectRatio(params.assetPath);
      return <AssetOverlayRect aspectRatio={aspectRatio} color={definition.color} ctx={ctx} onParamsChange={onParamsChange} params={params} selected={selected} />;
    }
  };
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
  const normalizedOverlay = normalizeAssetOverlay(params, ctx.imageBounds, aspectRatio, MIN_ASSET_OVERLAY_SIZE);
  const stageRect = assetOverlayToStageRect(normalizedOverlay, ctx);
  return (
    <InteractiveOverlayRect
      aspectRatio={normalizedOverlay.lockAspectRatio ? aspectRatio : null}
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
  const [aspectRatio, setAspectRatio] = useState(() => normalizeAssetAspectRatio(null));
  useEffect(() => {
    let cancelled = false;
    void readLocalAssetAspectRatio(assetPath).then((next) => {
      if (!cancelled) {
        setAspectRatio(normalizeAssetAspectRatio(next));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assetPath]);
  return aspectRatio;
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
  const normalized = normalizeAssetOverlay({ ...params, assetPath: nextAssetPath }, imageBounds, aspectRatio, MIN_ASSET_OVERLAY_SIZE);
  return {
    assetPath: nextAssetPath,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height
  };
}

function assetOverlayToStageRect(
  params: AssetOverlayParams,
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } }
): { x: number; y: number; w: number; h: number; rotation: number } {
  const width = params.width * ctx.longEdge;
  const height = params.height * ctx.longEdge;
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
  const height = rect.h / (ctx.placement.scale * ctx.longEdge);
  const normalized = normalizeAssetOverlay({
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    width,
    height,
    rotation: normalizeAngle(rect.rotation ?? 0)
  }, ctx.imageBounds, aspectRatio, MIN_ASSET_OVERLAY_SIZE);
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    rotation: normalized.rotation
  };
}

async function readLocalAssetAspectRatio(assetPath: string): Promise<number> {
  if (!assetPath) return normalizeAssetAspectRatio(null);
  return new Promise((resolve) => {
    const next = new window.Image();
    next.onload = () => resolve(readRenderedAssetAspectRatio(next));
    next.onerror = () => resolve(normalizeAssetAspectRatio(null));
    next.src = fileUrl(assetPath);
  });
}

function sameGeometry(left: AssetOverlayParams, right: AssetOverlayParams): boolean {
  return (
    nearlyEqual(left.x, right.x)
    && nearlyEqual(left.y, right.y)
    && nearlyEqual(left.width, right.width)
    && nearlyEqual(left.height, right.height)
    && left.lockAspectRatio === right.lockAspectRatio
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function fileUrl(assetPath: string): string {
  const normalized = assetPath.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return encodeURI(`file://${absolute}`).replaceAll("#", "%23");
}

function readRenderedAssetAspectRatio(image: HTMLImageElement): number {
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight, 1));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return normalizeAssetAspectRatio(sourceWidth / Math.max(1, sourceHeight));
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const bounds = alphaBounds(data, width, height);
  if (!bounds) {
    return normalizeAssetAspectRatio(null);
  }
  return normalizeAssetAspectRatio(bounds.width / Math.max(1, bounds.height));
}

function alphaBounds(data: Uint8ClampedArray, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

type AssetOverlayCardProps = Parameters<NonNullable<OpRenderer<AssetOverlayParams>["Card"]>>[0];
