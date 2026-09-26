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
  const { t, rich } = useI18n();
  return (
    <>
      <div className="geometry-toolbar-row">
        <div className="geometry-stepper-group">
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value - 90))}>-90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(normalizeAngle(value + 90))}>+90°</button>
          <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => onChange(0)}>{t("common.reset")}</button>
        </div>
        <span className="geometry-status">{rich("geometry.angleStatus", { angle: <strong>{formatAngle(value)}</strong> })}</span>
      </div>
      <label className="stacked-field geometry-range-field">
        {rangeLabel ?? t("geometry.angle")}
        <input disabled={disabled} max={180} min={-180} step={1} type="range" value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
      </label>
    </>
  );
}
