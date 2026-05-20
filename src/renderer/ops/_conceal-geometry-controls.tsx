import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { fractionToPixels, pixelsToFraction } from "./_slider-units";

export function ConcealGeometryControls({
  disabled,
  imageBounds,
  longEdge,
  region,
  onChange
}: {
  disabled: boolean;
  imageBounds: { maxX: number; maxY: number };
  longEdge: number;
  region: ConcealRegion;
  onChange(patch: Partial<ConcealRegion>): void;
}): React.JSX.Element {
  const minSize = Math.max(1, fractionToPixels(0.01, longEdge));
  const xMax = fractionToPixels(Math.max(0, imageBounds.maxX - region.w), longEdge);
  const yMax = fractionToPixels(Math.max(0, imageBounds.maxY - region.h), longEdge);
  const wMax = Math.max(minSize, fractionToPixels(Math.max(0.01, imageBounds.maxX - region.x), longEdge));
  const hMax = Math.max(minSize, fractionToPixels(Math.max(0.01, imageBounds.maxY - region.y), longEdge));

  return (
    <>
      <label className="slider-row">
        <span>X</span>
        <input
          disabled={disabled}
          max={xMax}
          min={0}
          step={1}
          type="range"
          value={fractionToPixels(region.x, longEdge)}
          onChange={(event) => onChange({ x: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
        />
        <span className="slider-value">{`${fractionToPixels(region.x, longEdge)}px`}</span>
      </label>
      <label className="slider-row">
        <span>Y</span>
        <input
          disabled={disabled}
          max={yMax}
          min={0}
          step={1}
          type="range"
          value={fractionToPixels(region.y, longEdge)}
          onChange={(event) => onChange({ y: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
        />
        <span className="slider-value">{`${fractionToPixels(region.y, longEdge)}px`}</span>
      </label>
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={wMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPixels(region.w, longEdge)}
          onChange={(event) => onChange({ w: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
        />
        <span className="slider-value">{`${fractionToPixels(region.w, longEdge)}px`}</span>
      </label>
      <label className="slider-row">
        <span>Height</span>
        <input
          disabled={disabled}
          max={hMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPixels(region.h, longEdge)}
          onChange={(event) => onChange({ h: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
        />
        <span className="slider-value">{`${fractionToPixels(region.h, longEdge)}px`}</span>
      </label>
      <AngleControl disabled={disabled} value={region.rotation} onChange={(rotation) => onChange({ rotation: normalizeAngle(rotation) })} />
    </>
  );
}
