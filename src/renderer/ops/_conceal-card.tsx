import React from "react";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import type { OpCardProps } from "./op-renderer";
import { ConcealGeometryControls } from "./_conceal-geometry-controls";
import { clampConcealRegion, readConcealRegionList, replacePrimaryConcealRegion, updateConcealRegion } from "./_conceal-primitives";
import { imageBoundsFromOriginalSize } from "./_overlay-primitives";

/**
 * Shared card scaffolding for cover/blur/mosaic. Owns the shape toggle and the
 * X/Y/W/H/rotation controls; per-op extras (color, opacity, radius, …) render
 * underneath via `children`.
 */
export function ConcealCard<P extends { rects: ConcealRegion[] } & Record<string, unknown>>({
  params,
  disabled,
  ctx,
  onParamChange,
  children
}: OpCardProps<P> & { children?: React.ReactNode }): React.JSX.Element {
  const imageBounds = imageBoundsFromOriginalSize(ctx.originalSize);
  const firstRegion = clampConcealRegion(readConcealRegionList(params.rects)[0] ?? DEFAULT_CONCEAL_REGION, imageBounds);

  function updateRegion(updates: Partial<ConcealRegion>): void {
    const nextRegion = updateConcealRegion(firstRegion, updates, imageBounds);
    onParamChange("rects" as keyof P, replacePrimaryConcealRegion(params.rects, nextRegion) as P[keyof P]);
  }

  return (
    <div className="geometry-controls">
      <div className="segmented-control">
        <button
          className={firstRegion.shape === "rectangle" ? "active" : ""}
          disabled={disabled}
          type="button"
          onClick={() => updateRegion({ shape: "rectangle" })}
        >
          Rectangle
        </button>
        <button
          className={firstRegion.shape === "ellipse" ? "active" : ""}
          disabled={disabled}
          type="button"
          onClick={() => updateRegion({ shape: "ellipse" })}
        >
          Ellipse
        </button>
      </div>
      <ConcealGeometryControls disabled={disabled} imageBounds={imageBounds} region={firstRegion} onChange={updateRegion} />
      {children}
    </div>
  );
}
