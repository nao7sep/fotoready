import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction } from "./_slider-units";

export function ConcealGeometryControls({
  disabled,
  imageBounds,
  region,
  onChange
}: {
  disabled: boolean;
  imageBounds: { maxX: number; maxY: number };
  region: ConcealRegion;
  onChange(patch: Partial<ConcealRegion>): void;
}): React.JSX.Element {
  const minSize = fractionToPercentSteps(0.01);
  const xMax = fractionToPercentSteps(imageBounds.maxX);
  const yMax = fractionToPercentSteps(imageBounds.maxY);
  const wMax = fractionToPercentSteps(imageBounds.maxX);
  const hMax = fractionToPercentSteps(imageBounds.maxY);

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
          value={fractionToPercentSteps(region.x)}
          onChange={(event) => onChange({ x: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(region.x)}</span>
      </label>
      <label className="slider-row">
        <span>Y</span>
        <input
          disabled={disabled}
          max={yMax}
          min={0}
          step={1}
          type="range"
          value={fractionToPercentSteps(region.y)}
          onChange={(event) => onChange({ y: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(region.y)}</span>
      </label>
      <label className="slider-row">
        <span>Width</span>
        <input
          disabled={disabled}
          max={wMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(region.w)}
          onChange={(event) => onChange({ w: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(region.w)}</span>
      </label>
      <label className="slider-row">
        <span>Height</span>
        <input
          disabled={disabled}
          max={hMax}
          min={minSize}
          step={1}
          type="range"
          value={fractionToPercentSteps(region.h)}
          onChange={(event) => onChange({ h: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
        />
        <span className="slider-value">{formatPercent(region.h)}</span>
      </label>
      <AngleControl disabled={disabled} value={region.rotation} onChange={(rotation) => onChange({ rotation: normalizeAngle(rotation) })} />
    </>
  );
}
