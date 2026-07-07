import React from "react";
import { MAX_RESIZE_DIMENSION, MAX_RESIZE_PIXELS } from "@shared/constants";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";
import type { OpRenderer } from "./op-renderer";

type ResizeMode = "fit" | "exact";
type ResizeUiMode = "fit" | "exact";
type ResizeParams = { mode: ResizeMode; width: number; height: number; interpolation: string };

const resizeModeOptions: ReadonlyArray<{ id: ResizeUiMode; label: string }> = [
  { id: "fit", label: "Fit" },
  { id: "exact", label: "Exact" }
];
const resizePresets = [200, 256, 400, 512, 800, 1024, 1280, 1600, 1920, 2048, 2560, 3200, 3840] as const;

export const resizeRenderer: OpRenderer<ResizeParams> = {
  type: "resize",
  Card({ params, disabled, onParamChange, onParamsChange }) {
    const activeMode = toUiMode(params.mode);
    const widthMax = maxResizeDimension(params.height);
    const heightMax = maxResizeDimension(params.width);
    const widthSliderValue = dimensionToSliderValue(params.width, widthMax);
    const heightSliderValue = dimensionToSliderValue(params.height, heightMax);

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
          <span className="geometry-status">Target: <strong>{params.width}×{params.height}px</strong></span>
        </div>
        <SegmentedRadioGroup
          className="geometry-chip-group"
          optionClassName="toolbar-button compact-text"
          ariaLabel="Resize mode"
          options={resizeModeOptions}
          value={activeMode}
          onChange={(mode) => onParamChange("mode", mode)}
          disabled={disabled}
        />
        <div
          ref={presetsRef}
          role="toolbar"
          aria-label="Common resize presets"
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
          <label className="stacked-field geometry-number-field">
            Width
            <input
              disabled={disabled}
              max={widthMax}
              min={1}
              step={1}
              type="number"
              value={params.width}
              onChange={(event) => onParamChange("width", clampResizeDimension(event.currentTarget.valueAsNumber, params.height))}
            />
          </label>
          <label className="stacked-field geometry-number-field">
            Height
            <input
              disabled={disabled}
              max={heightMax}
              min={1}
              step={1}
              type="number"
              value={params.height}
              onChange={(event) => onParamChange("height", clampResizeDimension(event.currentTarget.valueAsNumber, params.width))}
            />
          </label>
        </div>
        <label className="slider-row">
          <span>Width</span>
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
          <span>Height</span>
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
        <div className="modal-warning">Resize usually works best near the end of the pipeline.</div>
      </div>
    );
  }
};

function clampResizeDimension(value: number, otherDimension: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(Math.round(value), maxResizeDimension(otherDimension)));
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
