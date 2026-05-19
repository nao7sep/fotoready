import React, { useEffect, useState } from "react";
import { MAX_RESIZE_DIMENSION, MAX_RESIZE_PIXELS } from "@shared/constants";
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
    const [draftWidth, setDraftWidth] = useState(String(params.width));
    const [draftHeight, setDraftHeight] = useState(String(params.height));

    useEffect(() => {
      setDraftWidth(String(params.width));
      setDraftHeight(String(params.height));
    }, [params.height, params.width]);

    function setDimension(key: "width" | "height", rawValue: string): void {
      const nextValue = cleanPositiveInteger(rawValue);
      const nextWidth = key === "width" ? nextValue : draftWidth;
      const nextHeight = key === "height" ? nextValue : draftHeight;
      setDraftWidth(nextWidth);
      setDraftHeight(nextHeight);
      commitDimensions(nextWidth, nextHeight);
    }

    function commitDimensions(widthValue: string, heightValue: string): void {
      const width = parsePositiveInteger(widthValue);
      const height = parsePositiveInteger(heightValue);
      if (width === null || height === null) return;
      const issue = getResizeDraftIssue(width, height);
      if (issue) return;
      onParamsChange({ width, height });
    }

    function resetInvalidDraft(): void {
      if (!draftIssue && draftWidth.length > 0 && draftHeight.length > 0) return;
      setDraftWidth(String(params.width));
      setDraftHeight(String(params.height));
    }

    const draftIssue = getResizeDraftIssue(parsePositiveInteger(draftWidth), parsePositiveInteger(draftHeight));

    return (
      <div className="geometry-controls">
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Target: <strong>{params.width}×{params.height}px</strong></span>
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Resize mode">
          {resizeModeOptions.map((option) => (
            <button
              className={`geometry-chip ${activeMode === option.id ? "active" : ""}`}
              disabled={disabled}
              key={option.id}
              type="button"
              onClick={() => onParamChange("mode", option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="geometry-chip-group" role="group" aria-label="Common resize presets">
          {resizePresets.map((preset) => (
            <button
              className="geometry-chip"
              disabled={disabled}
              key={preset}
              type="button"
              onClick={() => {
                setDraftWidth(String(preset));
                setDraftHeight(String(preset));
                onParamChange("width", preset as never);
                onParamChange("height", preset as never);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <label className="stacked-field geometry-number-field">
            Width
            <input
              aria-invalid={draftIssue ? true : undefined}
              disabled={disabled}
              inputMode="numeric"
              type="text"
              value={draftWidth}
              onBlur={resetInvalidDraft}
              onChange={(e) => setDimension("width", e.currentTarget.value)}
            />
          </label>
          <label className="stacked-field geometry-number-field">
            Height
            <input
              aria-invalid={draftIssue ? true : undefined}
              disabled={disabled}
              inputMode="numeric"
              type="text"
              value={draftHeight}
              onBlur={resetInvalidDraft}
              onChange={(e) => setDimension("height", e.currentTarget.value)}
            />
          </label>
        </div>
        {draftIssue ? <div className="modal-error">{draftIssue}</div> : null}
        <div className="modal-warning">Resize usually works best near the end of the pipeline.</div>
      </div>
    );
  }
};

function cleanPositiveInteger(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getResizeDraftIssue(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;
  if (width > MAX_RESIZE_DIMENSION || height > MAX_RESIZE_DIMENSION) {
    return `Width and height must each be ${MAX_RESIZE_DIMENSION.toLocaleString()} px or less.`;
  }
  if (width * height > MAX_RESIZE_PIXELS) {
    return `Width × height must stay at or below ${MAX_RESIZE_PIXELS.toLocaleString()} pixels.`;
  }
  return null;
}

function toUiMode(mode: ResizeMode): ResizeUiMode {
  if (mode === "exact") return "exact";
  return "fit";
}
