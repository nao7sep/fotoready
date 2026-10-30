import { useI18n } from "@renderer/i18n/I18nContext";
import React from "react";
import { MAX_RESIZE_DIMENSION, MAX_RESIZE_PIXELS } from "@shared/constants";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";
import { NumberField } from "@renderer/components/number-field";
import { opFieldKey, useEditorStore } from "@renderer/state/editor-store";
import { readWholeNumber } from "@shared/number-text";
import type { OpCardContext, OpRenderer } from "./op-renderer";
import type { MessageKey } from "@shared/i18n/catalogues";

type ResizeMode = "fit" | "exact";
type ResizeUiMode = "fit" | "exact";
type ResizeParams = { mode: ResizeMode; width: number; height: number; interpolation: string };

const resizeModeOptions: ReadonlyArray<{ id: ResizeUiMode; label: MessageKey }> = [
  { id: "fit", label: "resize.fit" },
  { id: "exact", label: "resize.exact" }
];
const resizePresets = [200, 256, 400, 512, 800, 1024, 1280, 1600, 1920, 2048, 2560, 3200, 3840] as const;

export const resizeRenderer: OpRenderer<ResizeParams> = {
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const { t, rich } = useI18n();
    const activeMode = toUiMode(params.mode);
    const widthMax = maxResizeDimension(params.height);
    const heightMax = maxResizeDimension(params.width);
    const widthSliderValue = dimensionToSliderValue(params.width, widthMax);
    const heightSliderValue = dimensionToSliderValue(params.height, heightMax);
    const width = useDimensionText(ctx, "width", params.width, widthMax, (value) => onParamChange("width", value));
    const height = useDimensionText(ctx, "height", params.height, heightMax, (value) => onParamChange("height", value));

    // The preset sizes are a toolbar of quick actions (no persistent selection):
    // one tab stop via roving tabindex, arrow keys move focus, Home/End jump, and
    // the last-focused preset is remembered for the next Tab in.
    const presetCount = resizePresets.length;
    const [presetFocus, setPresetFocus] = React.useState(0);
    const presetsRef = React.useRef<HTMLDivElement>(null);
    const focusPreset = (index: number) => {
      const clamped = Math.min(Math.max(index, 0), presetCount - 1);
      setPresetFocus(clamped);
      (
        presetsRef.current?.querySelector(
          `[data-preset-index="${clamped}"]`,
        ) as HTMLElement | null
      )?.focus();
    };
    const onPresetsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        focusPreset(presetFocus + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        focusPreset(presetFocus - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusPreset(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusPreset(presetCount - 1);
      }
    };

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">{rich("resize.targetStatus", { size: <strong>{params.width}×{params.height}px</strong> })}</span>
        </div>
        <SegmentedRadioGroup
          className="geometry-chip-group"
          optionClassName="toolbar-button compact-text"
          ariaLabel={t("resize.mode")}
          options={resizeModeOptions.map((option) => ({ id: option.id, label: t(option.label) }))}
          value={activeMode}
          onChange={(mode) => onParamChange("mode", mode)}
          disabled={disabled}
        />
        <div
          ref={presetsRef}
          role="toolbar"
          aria-label={t("resize.presets")}
          className="geometry-chip-group"
          onKeyDown={onPresetsKeyDown}
        >
          {resizePresets.map((preset, index) => (
            <button
              className="toolbar-button compact-text"
              disabled={disabled}
              key={preset}
              data-preset-index={index}
              tabIndex={index === presetFocus ? 0 : -1}
              type="button"
              onClick={() => onParamsChange({ width: preset, height: preset })}
              onFocus={() => setPresetFocus(index)}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <NumberField
            className="stacked-field geometry-number-field"
            disabled={disabled}
            error={width.error}
            label={t("geometry.width")}
            text={width.text}
            onTextChange={width.change}
          />
          <NumberField
            className="stacked-field geometry-number-field"
            disabled={disabled}
            error={height.error}
            label={t("geometry.height")}
            text={height.text}
            onTextChange={height.change}
          />
        </div>
        <label className="slider-row">
          <span>{t("geometry.width")}</span>
          <input
            disabled={disabled}
            max={100}
            min={0}
            step={1}
            type="range"
            value={widthSliderValue}
            onChange={(event) => onParamChange("width", sliderValueToDimension(event.currentTarget.valueAsNumber, widthMax))}
          />
          <span className="slider-value">{`${params.width}px`}</span>
        </label>
        <label className="slider-row">
          <span>{t("geometry.height")}</span>
          <input
            disabled={disabled}
            max={100}
            min={0}
            step={1}
            type="range"
            value={heightSliderValue}
            onChange={(event) => onParamChange("height", sliderValueToDimension(event.currentTarget.valueAsNumber, heightMax))}
          />
          <span className="slider-value">{`${params.height}px`}</span>
        </label>
        <div className="modal-warning">{t("resize.hint")}</div>
      </div>
    );
  }
};

/**
 * A width or height field: whole numbers from 1 to `max`, which the other dimension sets (the core
 * checks the same bounds). A typed value commits as soon as it is valid; text that is not stays in
 * the field and in the editor store, so the task cannot be saved, and the op keeps its last value.
 */
function useDimensionText(
  ctx: OpCardContext,
  field: "width" | "height",
  value: number,
  max: number,
  commit: (value: number) => void
): { text: string; error: string | null; change(text: string): void } {
  const { t } = useI18n();
  const key = ctx.activeTaskId === null ? null : opFieldKey(ctx.activeTaskId, ctx.opId, field);
  const setInvalidOpField = useEditorStore((state) => state.setInvalidOpField);
  const [text, setText] = React.useState(() => (key === null ? undefined : useEditorStore.getState().invalidOpFields[key]) ?? String(value));
  const valid = readWholeNumber(text, 1, max);
  const error = valid === null ? t("number.wholeRange", { min: 1, max }) : null;

  // The value the field last showed. When the other dimension changes the bound, typed text that
  // now fits commits; when this value changes from elsewhere (a slider, a preset, undo), the field
  // shows it instead.
  const shownValue = React.useRef(value);
  React.useEffect(() => {
    if (shownValue.current === value && valid !== null && valid !== value) commit(valid);
  }, [max]);
  React.useEffect(() => {
    if (shownValue.current === value) return;
    shownValue.current = value;
    setText((current) => (readWholeNumber(current, 1, MAX_RESIZE_DIMENSION) === value ? current : String(value)));
  }, [value]);
  React.useEffect(() => {
    if (key !== null) setInvalidOpField(key, error === null ? null : text);
  }, [key, error === null, text]);

  return {
    text,
    error,
    change(next) {
      setText(next);
      const parsed = readWholeNumber(next, 1, max);
      if (parsed !== null && parsed !== value) commit(parsed);
    }
  };
}

function maxResizeDimension(otherDimension: number): number {
  return Math.max(1, Math.min(MAX_RESIZE_DIMENSION, Math.floor(MAX_RESIZE_PIXELS / Math.max(1, otherDimension))));
}

function toUiMode(mode: ResizeMode): ResizeUiMode {
  if (mode === "exact") return "exact";
  return "fit";
}

function dimensionToSliderValue(value: number, max: number): number {
  if (max <= 1) return 0;
  const clamped = Math.max(1, Math.min(value, max));
  return Math.round((Math.log(clamped) / Math.log(max)) * 100);
}

function sliderValueToDimension(value: number, max: number): number {
  if (max <= 1) return 1;
  const normalized = Math.max(0, Math.min(value, 100)) / 100;
  return Math.max(1, Math.min(max, Math.round(Math.exp(normalized * Math.log(max)))));
}
