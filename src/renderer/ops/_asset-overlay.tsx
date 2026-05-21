import React, { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ASSET_OVERLAY_HEIGHT,
  DEFAULT_ASSET_OVERLAY_WIDTH,
  MIN_ASSET_OVERLAY_SIZE,
  normalizeAssetAspectRatio,
  type AssetOverlayParams
} from "@shared/asset-overlay";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { clampConcealRegion, concealRegionFromStage, concealRegionToStage, updateConcealRegion } from "./_conceal-primitives";
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

  // Use the aspect ratio implied by the stored params themselves for normalization so
  // that a stale default AR from useLocalAssetAspectRatio cannot overwrite a correctly
  // set width/height that was just returned by normalizeAssetOverlayForPath.
  // The externally-loaded aspectRatio is still used for lock-based user interactions below.
  const storedAspectRatio = params.width > 0.001 && params.height > 0.001
    ? params.width / params.height
    : aspectRatio;

  const normalizedOverlay = useMemo(
    () => normalizeAssetOverlayGeometry(params, imageBounds, storedAspectRatio),
    [storedAspectRatio, imageBounds.maxX, imageBounds.maxY, params]
  );

  useEffect(() => {
    if (!params.assetPath || !ctx.originalSize) return;
    if (sameGeometry(params, normalizedOverlay)) return;
    onParamsChange({
      x: normalizedOverlay.x,
      y: normalizedOverlay.y,
      width: normalizedOverlay.width,
      height: normalizedOverlay.height,
      rotation: normalizedOverlay.rotation,
      lockAspectRatio: normalizedOverlay.lockAspectRatio
    });
  }, [ctx.originalSize, normalizedOverlay, onParamsChange, params]);

  const region = assetOverlayToRegion(normalizedOverlay);
  const minSize = fractionToPercentSteps(MIN_ASSET_OVERLAY_SIZE);
  const xMax = fractionToPercentSteps(imageBounds.maxX);
  const yMax = fractionToPercentSteps(imageBounds.maxY);
  const widthMax = fractionToPercentSteps(imageBounds.maxX);
  const heightMax = fractionToPercentSteps(imageBounds.maxY);

  function updateRegion(updates: Partial<ConcealRegion>, driver: "width" | "height" = "width"): void {
    const nextRegion = updateAssetOverlayRegion(region, updates, imageBounds, aspectRatio, normalizedOverlay.lockAspectRatio, driver);
    onParamsChange(assetOverlayPatchFromRegion(nextRegion));
  }

  function updateLockAspectRatio(locked: boolean): void {
    const nextRegion = locked
      ? fitLockedAssetRegion(region, imageBounds, aspectRatio, "width")
      : clampConcealRegion(region, imageBounds);
    onParamsChange({
      ...assetOverlayPatchFromRegion(nextRegion),
      lockAspectRatio: locked
    });
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
          onChange={(event) => updateRegion({ x: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
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
          onChange={(event) => updateRegion({ y: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.y)}</span>
      </label>
      <label className="toggle-row">
        <input
          checked={normalizedOverlay.lockAspectRatio}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => updateLockAspectRatio(event.currentTarget.checked)}
        />
        Lock aspect ratio
      </label>
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={widthMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.width)}
          onChange={(event) => updateRegion({ w: percentStepsToFraction(event.currentTarget.valueAsNumber) }, "width")}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.width)}</span>
      </label>
      <label className="slider-row">
        <span>Height</span>
        <input
          disabled={disabled}
          max={heightMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(normalizedOverlay.height)}
          onChange={(event) => updateRegion({ h: percentStepsToFraction(event.currentTarget.valueAsNumber) }, "height")}
        />
        <span className="slider-value">{formatPercent(normalizedOverlay.height)}</span>
      </label>
      <AngleControl disabled={disabled} value={normalizedOverlay.rotation} onChange={(rotation) => updateRegion({ rotation: normalizeAngle(rotation) })} />
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
  const normalizedOverlay = normalizeAssetOverlayGeometry(params, ctx.imageBounds, aspectRatio);
  const stageRect = concealRegionToStage(assetOverlayToRegion(normalizedOverlay), ctx.longEdge, ctx.placement);
  return (
    <InteractiveOverlayRect
      aspectRatio={normalizedOverlay.lockAspectRatio ? aspectRatio : null}
      color={color}
      placement={ctx.placement}
      rect={stageRect}
      rotateEnabled
      onChange={() => undefined}
      onCommit={(next) => {
        const nextRegion = concealRegionFromStage(next, ctx.longEdge, ctx.placement, "rectangle");
        const committed = normalizedOverlay.lockAspectRatio
          ? fitLockedAssetRegion(nextRegion, ctx.imageBounds, aspectRatio, "width")
          : clampConcealRegion(nextRegion, ctx.imageBounds);
        onParamsChange(assetOverlayPatchFromRegion(committed));
      }}
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
  const normalized = normalizeAssetOverlayGeometry({ ...params, assetPath: nextAssetPath }, imageBounds, aspectRatio);
  return {
    assetPath: nextAssetPath,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height
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
    && nearlyEqual(left.rotation, right.rotation)
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

function normalizeAssetOverlayGeometry(
  params: AssetOverlayParams,
  imageBounds: { maxX: number; maxY: number },
  aspectRatio: number
): AssetOverlayParams {
  const lockAspectRatio = params.lockAspectRatio ?? true;
  const baseRegion = clampConcealRegion(assetOverlayToRegion({
    ...params,
    width: readPositive(params.width, DEFAULT_ASSET_OVERLAY_WIDTH),
    height: readPositive(params.height, DEFAULT_ASSET_OVERLAY_HEIGHT),
    rotation: normalizeAngle(params.rotation)
  }), imageBounds);
  const region = lockAspectRatio
    ? fitLockedAssetRegion(baseRegion, imageBounds, aspectRatio, readPositive(params.width, 0) > 0 ? "width" : "height")
    : baseRegion;
  return {
    ...params,
    lockAspectRatio,
    x: region.x,
    y: region.y,
    width: region.w,
    height: region.h,
    rotation: region.rotation
  };
}

function updateAssetOverlayRegion(
  current: ConcealRegion,
  updates: Partial<ConcealRegion>,
  imageBounds: { maxX: number; maxY: number },
  aspectRatio: number,
  lockAspectRatio: boolean,
  driver: "width" | "height"
): ConcealRegion {
  if (!lockAspectRatio) {
    return updateConcealRegion(current, updates, imageBounds);
  }
  const moved = updateConcealRegion(current, {
    x: updates.x,
    y: updates.y,
    rotation: updates.rotation
  }, imageBounds);
  const requested: ConcealRegion = {
    ...moved,
    w: updates.w ?? moved.w,
    h: updates.h ?? moved.h
  };
  return fitLockedAssetRegion(requested, imageBounds, aspectRatio, driver);
}

function fitLockedAssetRegion(
  region: ConcealRegion,
  imageBounds: { maxX: number; maxY: number },
  aspectRatio: number,
  driver: "width" | "height"
): ConcealRegion {
  const current = clampConcealRegion(region, imageBounds);
  if (driver === "height") {
    let h = clamp(current.h, MIN_ASSET_OVERLAY_SIZE, Math.max(MIN_ASSET_OVERLAY_SIZE, imageBounds.maxY - current.y));
    let w = h * aspectRatio;
    if (w > imageBounds.maxX - current.x) {
      w = Math.max(MIN_ASSET_OVERLAY_SIZE, imageBounds.maxX - current.x);
      h = w / Math.max(0.01, aspectRatio);
    }
    return {
      ...current,
      w,
      h
    };
  }
  let w = clamp(current.w, MIN_ASSET_OVERLAY_SIZE, Math.max(MIN_ASSET_OVERLAY_SIZE, imageBounds.maxX - current.x));
  let h = w / Math.max(0.01, aspectRatio);
  if (h > imageBounds.maxY - current.y) {
    h = Math.max(MIN_ASSET_OVERLAY_SIZE, imageBounds.maxY - current.y);
    w = h * aspectRatio;
  }
  return {
    ...current,
    w,
    h
  };
}

function assetOverlayToRegion(params: Pick<AssetOverlayParams, "x" | "y" | "width" | "height" | "rotation">): ConcealRegion {
  return {
    x: params.x,
    y: params.y,
    w: params.width,
    h: params.height,
    rotation: params.rotation,
    shape: "rectangle"
  };
}

function assetOverlayPatchFromRegion(region: ConcealRegion): Partial<AssetOverlayParams> {
  return {
    x: region.x,
    y: region.y,
    width: region.w,
    height: region.h,
    rotation: region.rotation
  };
}

function readPositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
