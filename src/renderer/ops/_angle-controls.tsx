import React from "react";
import { formatAngle, normalizeAngle } from "@shared/rotation";

export { formatAngle, normalizeAngle };

export function AngleControl({
  value,
  disabled,
  onChange,
  rangeLabel = "Angle"
}: {
  value: number;
  disabled: boolean;
  onChange(value: number): void;
  rangeLabel?: string;
}): React.JSX.Element {
  return (
    <>
      <div className="geometry-toolbar-row">
        <div className="geometry-stepper-group">
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value - 90))}>-90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value + 90))}>+90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(0)}>Reset</button>
        </div>
        <span className="geometry-status">Angle: <strong>{formatAngle(value)}</strong></span>
      </div>
      <label className="stacked-field geometry-range-field">
        {rangeLabel}
        <input disabled={disabled} max={180} min={-180} step={1} type="range" value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
      </label>
    </>
  );
}
