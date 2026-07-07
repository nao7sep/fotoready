import React, { useEffect, useState } from "react";
import {
  DEFAULT_ASSET_OVERLAY_WIDTH,
  MIN_ASSET_OVERLAY_SIZE,
  clampAssetOverlay,
  type AssetOverlayParams
} from "@shared/asset-overlay";
import { api } from "@renderer/ipc/client";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { imageBoundsFromOriginalSize, rectFromStage, rectToStage, updateFractionRect, type FractionRect } from "./_overlay-primitives";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction } from "./_slider-units";
import type { OpCardContext, OpRenderer, OverlayContext } from "./op-renderer";

type AssetOverlayCardProps = Parameters<NonNullable<OpRenderer<AssetOverlayParams>["Card"]>>[0];

export function createAssetOverlayRenderer(definition: {
  type: string;
  color: string;
  flipControlsPlacement?: "after-source" | "after-angle";
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
          onParamChange={props.onParamChange}
          onParamsChange={props.onParamsChange}
          params={props.params}
          flipControlsPlacement={definition.flipControlsPlacement}
          sourceAction={definition.renderSourceAction(props)}
          sourceField={definition.renderSourceField(props)}
        />
      );
    },
    Overlay({ params, selected, ctx, onParamsChange }) {
      const aspectRatio = useLocalAssetAspectRatio(params.assetPath);
      return (
        <AssetOverlayRect
          aspectRatio={aspectRatio}
          color={definition.color}
          ctx={ctx}
          onParamsChange={onParamsChange}
          params={params}
          selected={selected}
        />
      );
    }
  };
}

function AssetOverlayControls({
  aspectRatio,
  ctx,
  disabled,
  onParamChange,
  onParamsChange,
  params,
  flipControlsPlacement,
  sourceAction,
  sourceField
}: {
  aspectRatio: number;
  ctx: OpCardContext;
  disabled: boolean;
  onParamChange<K extends keyof AssetOverlayParams>(key: K, value: AssetOverlayParams[K]): void;
  onParamsChange(patch: Partial<AssetOverlayParams>): void;
  params: AssetOverlayParams;
  flipControlsPlacement?: "after-source" | "after-angle";
  sourceAction: React.ReactNode;
  sourceField: React.ReactNode;
}): React.JSX.Element {
  const bounds = imageBoundsFromOriginalSize(ctx.originalSize);
  const o = clampAssetOverlay(params, bounds);
  const minSize = fractionToPercentSteps(MIN_ASSET_OVERLAY_SIZE);

  function applyBoxPatch(patch: Partial<AssetOverlayParams>): void {
    onParamsChange(updateAssetOverlayBox(o, patch, bounds, aspectRatio));
  }

  return (
    <div className="geometry-controls">
      {sourceField}
      {sourceAction}
      {flipControlsPlacement === "after-source" ? (
        <AssetOverlayFlipControls disabled={disabled} params={o} onParamChange={onParamChange} />
      ) : null}
      <label className="slider-row">
        <span>X</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(bounds.maxX)}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.x)}
          onChange={(e) => applyBoxPatch({ x: percentStepsToFraction(e.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(o.x)}</span>
      </label>
      <label className="slider-row">
        <span>Y</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(bounds.maxY)}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.y)}
          onChange={(e) => applyBoxPatch({ y: percentStepsToFraction(e.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(o.y)}</span>
      </label>
      <label className="toggle-row">
        <input
          checked={o.lockAspectRatio}
          disabled={disabled}
          type="checkbox"
          onChange={(e) => applyBoxPatch({ lockAspectRatio: e.currentTarget.checked })}
        />
        Lock aspect ratio
      </label>
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(bounds.maxX)}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.width)}
          onChange={(e) => applyBoxPatch({ width: percentStepsToFraction(e.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(o.width)}</span>
      </label>
      <label className="slider-row">
        <span>Height</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(bounds.maxY)}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.height)}
          onChange={(e) => applyBoxPatch({ height: percentStepsToFraction(e.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(o.height)}</span>
      </label>
      <AngleControl
        disabled={disabled}
        value={o.rotation}
        onChange={(rotation) => applyBoxPatch({ rotation: normalizeAngle(rotation) })}
      />
      {flipControlsPlacement === "after-angle" ? (
        <AssetOverlayFlipControls disabled={disabled} params={o} onParamChange={onParamChange} />
      ) : null}
      <label className="slider-row">
        <span>Opacity</span>
        <input
          disabled={disabled}
          max={1}
          min={0}
          step={0.01}
          type="range"
          value={o.opacity}
          onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)}
        />
        <span className="slider-value">{`${Math.round(o.opacity * 100)}%`}</span>
      </label>
    </div>
  );
}

function AssetOverlayFlipControls({
  disabled,
  params,
  onParamChange
}: {
  disabled: boolean;
  params: AssetOverlayParams;
  onParamChange<K extends keyof AssetOverlayParams>(key: K, value: AssetOverlayParams[K]): void;
}): React.JSX.Element {
  return (
    <div className="field-grid">
      <label className="toggle-row span-two">
        <input
          checked={params.flipHorizontal}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onParamChange("flipHorizontal", event.currentTarget.checked)}
        />
        <span>Flip horizontally</span>
      </label>
      <label className="toggle-row span-two">
        <input
          checked={params.flipVertical}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onParamChange("flipVertical", event.currentTarget.checked)}
        />
        <span>Flip vertically</span>
      </label>
    </div>
  );
}

/**
 * Apply a position/size/lock patch to an asset overlay. Delegates the geometry math to
 * the shared `updateFractionRect` so image-watermark, stamp, and text-watermark all share
 * one canonical clamp/lock implementation. The only asset-specific concerns handled here
 * are the `width`/`height` ↔ `w`/`h` key-name translation and the "lock just turned on"
 * UX where enabling the toggle snaps height to width / aspectRatio.
 */
function updateAssetOverlayBox(
  current: AssetOverlayParams,
  updates: Partial<AssetOverlayParams>,
  bounds: { maxX: number; maxY: number },
  aspectRatio: number
): Partial<AssetOverlayParams> {
  const safeAR = Math.max(0.01, aspectRatio);
  const lockNow = updates.lockAspectRatio ?? current.lockAspectRatio;
  const lockTurningOn = updates.lockAspectRatio === true && !current.lockAspectRatio;

  const rectUpdates: Partial<FractionRect> = {};
  if (updates.x !== undefined) rectUpdates.x = updates.x;
  if (updates.y !== undefined) rectUpdates.y = updates.y;
  if (updates.width !== undefined) rectUpdates.w = updates.width;
  if (updates.height !== undefined) rectUpdates.h = updates.height;
  if (lockTurningOn && updates.width === undefined && updates.height === undefined) {
    // Enabling the lock should snap height to width/AR rather than preserve a mismatched ratio.
    rectUpdates.h = current.width / safeAR;
  }

  const next = updateFractionRect(
    { x: current.x, y: current.y, w: current.width, h: current.height },
    rectUpdates,
    bounds,
    { minSize: MIN_ASSET_OVERLAY_SIZE, aspectLock: lockNow ? safeAR : null }
  );

  const clamped = clampAssetOverlay({
    ...current,
    x: next.x,
    y: next.y,
    width: next.w,
    height: next.h,
    rotation: updates.rotation ?? current.rotation
  }, bounds);
  const patch: Partial<AssetOverlayParams> = {
    x: clamped.x,
    y: clamped.y,
    width: clamped.width,
    height: clamped.height,
    rotation: clamped.rotation
  };
  if (updates.lockAspectRatio !== undefined) patch.lockAspectRatio = updates.lockAspectRatio;
  return patch;
}

function AssetOverlayRect({
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
  const o = clampAssetOverlay(params, ctx.imageBounds);
  const stageBox = rectToStage({ x: o.x, y: o.y, w: o.width, h: o.height }, ctx.longEdge, ctx.placement);
  return (
    <InteractiveOverlayRect
      aspectRatio={o.lockAspectRatio ? aspectRatio : null}
      color={color}
      placement={ctx.placement}
      rect={{ ...stageBox, rotation: o.rotation }}
      rotateEnabled
      onChange={() => undefined}
      onCommit={(next) => {
        const imageRect = rectFromStage(next, ctx.longEdge, ctx.placement);
        const clamped = clampAssetOverlay(
          {
            ...o,
            x: imageRect.x,
            y: imageRect.y,
            width: imageRect.w,
            height: imageRect.h,
            rotation: normalizeAngle(next.rotation ?? 0)
          },
          ctx.imageBounds
        );
        onParamsChange({
          x: clamped.x,
          y: clamped.y,
          width: clamped.width,
          height: clamped.height,
          rotation: clamped.rotation
        });
      }}
    />
  );
}

export async function normalizeAssetOverlayForPath(
  params: AssetOverlayParams,
  originalSize: { width: number; height: number } | null,
  nextAssetPath: string
): Promise<Partial<AssetOverlayParams>> {
  const aspectRatio = await readLocalAssetAspectRatio(nextAssetPath);
  const width = DEFAULT_ASSET_OVERLAY_WIDTH;
  const height = width / Math.max(0.01, aspectRatio);
  return clampAssetOverlay(
    { ...params, assetPath: nextAssetPath, width, height },
    imageBoundsFromOriginalSize(originalSize)
  );
}

export function useLocalAssetAspectRatio(assetPath: string): number {
  const [aspectRatio, setAspectRatio] = useState(1);
  useEffect(() => {
    let cancelled = false;
    void readLocalAssetAspectRatio(assetPath).then((ar) => {
      if (!cancelled) setAspectRatio(ar);
    });
    return () => { cancelled = true; };
  }, [assetPath]);
  return aspectRatio;
}

async function readLocalAssetAspectRatio(assetPath: string): Promise<number> {
  if (!assetPath) return 1;
  try {
    const ar = await api.assets.aspectRatio(assetPath);
    return Number.isFinite(ar) && ar > 0 ? ar : 1;
  } catch {
    return 1;
  }
}
