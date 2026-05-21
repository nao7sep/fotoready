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
import { imageBoundsFromOriginalSize, rectFromStage, rectToStage } from "./_overlay-primitives";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction } from "./_slider-units";
import type { OpCardContext, OpRenderer, OverlayContext } from "./op-renderer";

type AssetOverlayCardProps = Parameters<NonNullable<OpRenderer<AssetOverlayParams>["Card"]>>[0];

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
          onParamChange={props.onParamChange}
          onParamsChange={props.onParamsChange}
          params={props.params}
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
  const bounds = imageBoundsFromOriginalSize(ctx.originalSize);
  const o = clampAssetOverlay(params, bounds);
  const minSize = fractionToPercentSteps(MIN_ASSET_OVERLAY_SIZE);
  const safeAspectRatio = Math.max(0.01, aspectRatio);

  return (
    <div className="geometry-controls">
      {sourceField}
      {sourceAction}
      <label className="slider-row">
        <span>X</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(Math.max(0, bounds.maxX - o.width))}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.x)}
          onChange={(e) => onParamChange("x", percentStepsToFraction(e.currentTarget.valueAsNumber))}
        />
        <span className="slider-value">{formatPercent(o.x)}</span>
      </label>
      <label className="slider-row">
        <span>Y</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(Math.max(0, bounds.maxY - o.height))}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.y)}
          onChange={(e) => onParamChange("y", percentStepsToFraction(e.currentTarget.valueAsNumber))}
        />
        <span className="slider-value">{formatPercent(o.y)}</span>
      </label>
      <label className="toggle-row">
        <input
          checked={o.lockAspectRatio}
          disabled={disabled}
          type="checkbox"
          onChange={(e) => {
            if (e.currentTarget.checked) {
              onParamsChange({ lockAspectRatio: true, height: o.width / safeAspectRatio });
            } else {
              onParamChange("lockAspectRatio", false);
            }
          }}
        />
        Lock aspect ratio
      </label>
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(Math.max(MIN_ASSET_OVERLAY_SIZE, bounds.maxX - o.x))}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.width)}
          onChange={(e) => {
            const w = percentStepsToFraction(e.currentTarget.valueAsNumber);
            if (o.lockAspectRatio) {
              onParamsChange({ width: w, height: w / safeAspectRatio });
            } else {
              onParamChange("width", w);
            }
          }}
        />
        <span className="slider-value">{formatPercent(o.width)}</span>
      </label>
      <label className="slider-row">
        <span>Height</span>
        <input
          disabled={disabled}
          max={fractionToPercentSteps(Math.max(MIN_ASSET_OVERLAY_SIZE, bounds.maxY - o.y))}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(o.height)}
          onChange={(e) => {
            const h = percentStepsToFraction(e.currentTarget.valueAsNumber);
            if (o.lockAspectRatio) {
              onParamsChange({ height: h, width: h * safeAspectRatio });
            } else {
              onParamChange("height", h);
            }
          }}
        />
        <span className="slider-value">{formatPercent(o.height)}</span>
      </label>
      <AngleControl
        disabled={disabled}
        value={o.rotation}
        onChange={(rotation) => onParamChange("rotation", normalizeAngle(rotation))}
      />
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
