import { ANGLE_LIMITS } from "@shared/op-limits";
import { useI18n } from "@renderer/i18n/I18nContext";
import React from "react";
import { formatAngle, normalizeAngle } from "@shared/rotation";

export { formatAngle, normalizeAngle };

export function AngleControl({
  value,
  disabled,
  onChange,
  rangeLabel
}: {
  value: number;
  disabled: boolean;
  onChange(value: number): void;
  rangeLabel?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  // The angle is one slider row like the card's others, its value at the end; the steps sit above it.
  return (
    <>
      <div className="geometry-toolbar-row">
        <div className="geometry-stepper-group">
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value - 90))}>-90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value + 90))}>+90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(0)}>{t("common.reset")}</button>
        </div>
      </div>
      <label className="slider-row">
        <span>{rangeLabel ?? t("geometry.angle")}</span>
        <input disabled={disabled} max={ANGLE_LIMITS.max} min={ANGLE_LIMITS.min} step={1} type="range" value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
        <span className="slider-value">{formatAngle(value)}</span>
      </label>
    </>
  );
}
