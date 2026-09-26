import { useI18n } from "@renderer/i18n/I18nContext";
import { Line, Rect } from "react-konva";
import type { OpRenderer } from "./op-renderer";
import type { MessageKey } from "@shared/i18n/catalogues";
import type React from "react";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";

type RotateParams = { degrees: number; fillColor: string };

const rotateFillSwatches = [
  { value: "rgba(0,0,0,0)", label: "rotate.fill.transparent", style: { background: "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%), linear-gradient(45deg, #d1d5db 25%, #ffffff 25%, #ffffff 75%, #d1d5db 75%)", backgroundPosition: "0 0, 6px 6px", backgroundSize: "12px 12px" } },
  { value: "#ffffff", label: "rotate.fill.white", style: { background: "#ffffff" } },
  { value: "#000000", label: "rotate.fill.black", style: { background: "#000000" } },
  { value: "#00ff66", label: "rotate.fill.keyGreen", style: { background: "#00ff66" } },
  { value: "#0088ff", label: "rotate.fill.keyBlue", style: { background: "#0088ff" } }
] as const satisfies ReadonlyArray<{ value: string; label: MessageKey; style: React.CSSProperties }>;

export const rotateRenderer: OpRenderer<RotateParams> = {
  type: "rotate",
  Card({ params, disabled, onParamChange }) {
    const { t } = useI18n();
    return (
      <div className="geometry-controls">
        <AngleControl disabled={disabled} rangeLabel={t("rotate.range")} value={params.degrees} onChange={(degrees) => onParamChange("degrees", normalizeAngle(degrees))} />
        <div className="geometry-toolbar-row">
          <span className="geometry-status">{t("rotate.fill")}</span>
          <div className="geometry-swatch-group">
            <SegmentedRadioGroup
              className="geometry-swatch-group"
              optionClassName="color-swatch"
              ariaLabel={t("rotate.fillColor")}
              options={rotateFillSwatches.map((swatch) => ({
                id: swatch.value,
                ariaLabel: t(swatch.label),
                style: swatch.style,
                className: swatch.value === "rgba(0,0,0,0)" ? "transparent" : undefined,
              }))}
              value={
                rotateFillSwatches.find(
                  (swatch) =>
                    normalizeFillColor(params.fillColor) === normalizeFillColor(swatch.value),
                )?.value ?? null
              }
              onChange={(value) => onParamChange("fillColor", value)}
              disabled={disabled}
            />
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={colorPickerValue(params.fillColor)} onChange={(e) => onParamChange("fillColor", e.currentTarget.value)} />
            </label>
          </div>
        </div>
      </div>
    );
  },
  Overlay({ editable, ctx }) {
    if (!editable) return null;
    const { placement } = ctx;
    return (
      <>
        <Rect height={placement.height} stroke="#ffffffaa" strokeWidth={1} width={placement.width} x={placement.x} y={placement.y} />
        <Line dash={[8, 8]} stroke="#ffffffaa" strokeWidth={1} points={[placement.x + placement.width / 2, placement.y, placement.x + placement.width / 2, placement.y + placement.height]} />
        <Line dash={[8, 8]} stroke="#ffffffaa" strokeWidth={1} points={[placement.x, placement.y + placement.height / 2, placement.x + placement.width, placement.y + placement.height / 2]} />
      </>
    );
  }
};

function normalizeFillColor(value: string): string {
  return value.trim().toLowerCase();
}

function colorPickerValue(value: string): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value : "#ffffff";
}
