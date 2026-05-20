import React, { useId } from "react";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY, TEXT_WATERMARK_FONT_OPTIONS } from "@shared/watermark-text-layout";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { formatPercent, fractionToPercentSteps, onePixelStep, percentStepsToFraction, sliderLongEdge } from "./_slider-units";

type WatermarkTextParams = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  paddingX: number;
  paddingY: number;
  cornerRadius: number;
  borderColor: string;
  borderOpacity: number;
  borderWidth: number;
};

const MIN_TEXT_WATERMARK_BOX_SIZE = 0.02;

const BOX_COLOR_SWATCHES = [
  {
    key: "transparent",
    label: "Transparent",
    value: "transparent",
    style: {
      background:
        "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%), linear-gradient(45deg, #d1d5db 25%, #ffffff 25%, #ffffff 75%, #d1d5db 75%)",
      backgroundPosition: "0 0, 6px 6px",
      backgroundSize: "12px 12px"
    }
  },
  { key: "white", label: "White", value: "#ffffff", style: { background: "#ffffff" } },
  { key: "black", label: "Black", value: "#000000", style: { background: "#000000" } }
] as const;

export const watermarkTextRenderer: OpRenderer<WatermarkTextParams> = {
  type: "watermark-text",
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const longEdge = sliderLongEdge(ctx.originalSize);
    const imageBounds = ctx.originalSize
      ? { maxX: ctx.originalSize.width / longEdge, maxY: ctx.originalSize.height / longEdge }
      : { maxX: 1, maxY: 1 };
    const fontFamilyListId = useId();
    const normalizedBox = normalizeTextWatermarkBox(params, imageBounds, MIN_TEXT_WATERMARK_BOX_SIZE);
    const xMax = fractionToPercentSteps(imageBounds.maxX);
    const yMax = fractionToPercentSteps(imageBounds.maxY);
    const widthMax = fractionToPercentSteps(imageBounds.maxX);
    const heightMax = fractionToPercentSteps(imageBounds.maxY);
    const borderWidthFallback = Math.max(normalizedBox.borderWidth, onePixelStep(longEdge));

    function updateBox(updates: Partial<WatermarkTextParams>): void {
      onParamsChange(updateTextWatermarkBox(normalizedBox, updates, imageBounds, MIN_TEXT_WATERMARK_BOX_SIZE));
    }

    return (
      <div className="geometry-controls">
        <input
          className="compact-control"
          disabled={disabled}
          type="text"
          value={params.text}
          onChange={(event) => onParamChange("text", event.currentTarget.value)}
        />
        <label className="slider-row">
          <span>Width</span>
          <input
            disabled={disabled}
            max={widthMax}
            min={fractionToPercentSteps(MIN_TEXT_WATERMARK_BOX_SIZE)}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.w)}
            onChange={(event) => updateBox({ w: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedBox.w)}</span>
        </label>
        <label className="slider-row">
          <span>Height</span>
          <input
            disabled={disabled}
            max={heightMax}
            min={fractionToPercentSteps(MIN_TEXT_WATERMARK_BOX_SIZE)}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.h)}
            onChange={(event) => updateBox({ h: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedBox.h)}</span>
        </label>
        <label className="slider-row">
          <span>X</span>
          <input
            disabled={disabled}
            max={xMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.x)}
            onChange={(event) => updateBox({ x: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedBox.x)}</span>
        </label>
        <label className="slider-row">
          <span>Y</span>
          <input
            disabled={disabled}
            max={yMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.y)}
            onChange={(event) => updateBox({ y: percentStepsToFraction(event.currentTarget.valueAsNumber) })}
          />
          <span className="slider-value">{formatPercent(normalizedBox.y)}</span>
        </label>
        <AngleControl disabled={disabled} value={normalizedBox.rotation} onChange={(rotation) => onParamChange("rotation", normalizeAngle(rotation))} />
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Background</span>
          <div className="geometry-swatch-group" role="group" aria-label="Background color">
            {BOX_COLOR_SWATCHES.map((swatch) => (
              <button
                aria-label={`Use ${swatch.label.toLowerCase()} background`}
                className={`color-swatch ${backgroundSwatchActive(normalizedBox, swatch.value) ? "active" : ""}${swatch.value === "transparent" ? " transparent" : ""}`}
                disabled={disabled}
                key={swatch.key}
                style={swatch.style}
                type="button"
                onClick={() => onParamsChange(applyBackgroundSwatch(normalizedBox, swatch.value))}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={normalizedBox.backgroundColor} onChange={(event) => onParamsChange({ backgroundColor: event.currentTarget.value, backgroundOpacity: normalizedBox.backgroundOpacity > 0 ? normalizedBox.backgroundOpacity : 1 })} />
            </label>
          </div>
        </div>
        <label className="slider-row">
          <span>Background opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={normalizedBox.backgroundOpacity} onChange={(event) => onParamChange("backgroundOpacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(normalizedBox.backgroundOpacity * 100)}%`}</span>
        </label>
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Border</span>
          <div className="geometry-swatch-group" role="group" aria-label="Border color">
            {BOX_COLOR_SWATCHES.map((swatch) => (
              <button
                aria-label={`Use ${swatch.label.toLowerCase()} border`}
                className={`color-swatch ${borderSwatchActive(normalizedBox, swatch.value) ? "active" : ""}${swatch.value === "transparent" ? " transparent" : ""}`}
                disabled={disabled}
                key={`border-${swatch.key}`}
                style={swatch.style}
                type="button"
                onClick={() => onParamsChange(applyBorderSwatch(normalizedBox, swatch.value, borderWidthFallback))}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={normalizedBox.borderColor} onChange={(event) => onParamsChange({
                borderColor: event.currentTarget.value,
                borderOpacity: normalizedBox.borderOpacity > 0 ? normalizedBox.borderOpacity : 1,
                borderWidth: borderWidthFallback
              })} />
            </label>
          </div>
        </div>
        <label className="slider-row">
          <span>Border opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={normalizedBox.borderOpacity} onChange={(event) => onParamChange("borderOpacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(normalizedBox.borderOpacity * 100)}%`}</span>
        </label>
        <label className="slider-row">
          <span>Border thickness</span>
          <input
            disabled={disabled}
            max={fractionToPercentSteps(0.03)}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.borderWidth)}
            onChange={(event) => onParamChange("borderWidth", percentStepsToFraction(event.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{formatPercent(normalizedBox.borderWidth)}</span>
        </label>
        <label className="slider-row">
          <span>Corner radius</span>
          <input
            disabled={disabled}
            max={fractionToPercentSteps(0.08)}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.cornerRadius)}
            onChange={(event) => onParamChange("cornerRadius", percentStepsToFraction(event.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{formatPercent(normalizedBox.cornerRadius)}</span>
        </label>
        <label className="slider-row">
          <span>Horizontal padding</span>
          <input
            disabled={disabled}
            max={fractionToPercentSteps(0.08)}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.paddingX)}
            onChange={(event) => onParamChange("paddingX", percentStepsToFraction(event.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{formatPercent(normalizedBox.paddingX)}</span>
        </label>
        <label className="slider-row">
          <span>Vertical padding</span>
          <input
            disabled={disabled}
            max={fractionToPercentSteps(0.08)}
            min={0}
            step={1}
            type="range"
            value={fractionToPercentSteps(normalizedBox.paddingY)}
            onChange={(event) => onParamChange("paddingY", percentStepsToFraction(event.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{formatPercent(normalizedBox.paddingY)}</span>
        </label>
        <label className="stacked-field">
          Font family
          <input
            className="compact-control"
            disabled={disabled}
            list={fontFamilyListId}
            placeholder={DEFAULT_TEXT_WATERMARK_FONT_FAMILY}
            type="text"
            value={normalizedBox.fontFamily}
            onChange={(event) => onParamChange("fontFamily", event.currentTarget.value || DEFAULT_TEXT_WATERMARK_FONT_FAMILY)}
          />
          <datalist id={fontFamilyListId}>
            {TEXT_WATERMARK_FONT_OPTIONS.map((option) => (
              <option key={option.label} label={option.label} value={option.value} />
            ))}
          </datalist>
        </label>
        <div className="watermark-style-row">
          <button className={`toolbar-button compact-text ${normalizedBox.bold ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("bold", !normalizedBox.bold)}>Bold</button>
          <button className={`toolbar-button compact-text ${normalizedBox.italic ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("italic", !normalizedBox.italic)}>Italic</button>
          <button className={`toolbar-button compact-text ${normalizedBox.underline ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("underline", !normalizedBox.underline)}>Underline</button>
          <button className={`toolbar-button compact-text ${normalizedBox.strikeThrough ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("strikeThrough", !normalizedBox.strikeThrough)}>Strike</button>
        </div>
        <label className="control-row">
          <span>Text color</span>
          <input disabled={disabled} type="color" value={normalizedBox.color} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
        <label className="slider-row">
          <span>Text opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={normalizedBox.opacity} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(normalizedBox.opacity * 100)}%`}</span>
        </label>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    const normalizedBox = normalizeTextWatermarkBox(params, ctx.imageBounds, MIN_TEXT_WATERMARK_BOX_SIZE);
    if (!selected || !normalizedBox.text.trim()) return null;
    const stageRect = textWatermarkToStageRect(normalizedBox, ctx);
    return (
      <InteractiveOverlayRect
        color="#a78bfa"
        placement={ctx.placement}
        rect={stageRect}
        rotateEnabled
        onChange={() => undefined}
        onCommit={(next) => onParamsChange(stageRectToTextWatermark(next, ctx))}
      />
    );
  }
};

function textWatermarkToStageRect(
  params: WatermarkTextParams,
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number } }
): { x: number; y: number; w: number; h: number; rotation: number } {
  return {
    x: ctx.placement.x + params.x * ctx.longEdge * ctx.placement.scale,
    y: ctx.placement.y + params.y * ctx.longEdge * ctx.placement.scale,
    w: params.w * ctx.longEdge * ctx.placement.scale,
    h: params.h * ctx.longEdge * ctx.placement.scale,
    rotation: params.rotation
  };
}

function stageRectToTextWatermark(
  rect: { x: number; y: number; w: number; h: number; rotation?: number },
  ctx: { longEdge: number; placement: { x: number; y: number; scale: number }; imageBounds: { maxX: number; maxY: number } }
): Partial<WatermarkTextParams> {
  return normalizeTextWatermarkBox({
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    w: rect.w / (ctx.longEdge * ctx.placement.scale),
    h: rect.h / (ctx.longEdge * ctx.placement.scale),
    rotation: normalizeRotation(rect.rotation ?? 0)
  }, ctx.imageBounds, MIN_TEXT_WATERMARK_BOX_SIZE);
}

function normalizeTextWatermarkBox<T extends Partial<WatermarkTextParams>>(
  params: T,
  bounds: { maxX: number; maxY: number },
  minSize: number
): T {
  const w = clamp(params.w ?? 0.2, minSize, Math.max(minSize, bounds.maxX));
  const h = clamp(params.h ?? 0.06, minSize, Math.max(minSize, bounds.maxY));
  return {
    ...params,
    w,
    h,
    x: clamp(params.x ?? 0, 0, Math.max(0, bounds.maxX - w)),
    y: clamp(params.y ?? 0, 0, Math.max(0, bounds.maxY - h))
  };
}

function updateTextWatermarkBox(
  currentBox: WatermarkTextParams,
  updates: Partial<WatermarkTextParams>,
  bounds: { maxX: number; maxY: number },
  minSize: number
): WatermarkTextParams {
  const normalizedBox = normalizeTextWatermarkBox(currentBox, bounds, minSize);
  let x = normalizedBox.x;
  let y = normalizedBox.y;
  let w = normalizedBox.w;
  let h = normalizedBox.h;

  if (updates.x !== undefined) {
    x = clamp(updates.x, 0, Math.max(0, bounds.maxX - w));
  }
  if (updates.y !== undefined) {
    y = clamp(updates.y, 0, Math.max(0, bounds.maxY - h));
  }
  if (updates.w !== undefined) {
    w = clamp(updates.w, minSize, Math.max(minSize, bounds.maxX - x));
  } else {
    w = clamp(w, minSize, Math.max(minSize, bounds.maxX - x));
  }
  if (updates.h !== undefined) {
    h = clamp(updates.h, minSize, Math.max(minSize, bounds.maxY - y));
  } else {
    h = clamp(h, minSize, Math.max(minSize, bounds.maxY - y));
  }

  return {
    ...normalizedBox,
    ...updates,
    x,
    y,
    w,
    h
  };
}

function backgroundSwatchActive(params: WatermarkTextParams, value: string): boolean {
  if (value === "transparent") return params.backgroundOpacity === 0;
  return params.backgroundOpacity > 0 && normalizeColor(params.backgroundColor) === value;
}

function borderSwatchActive(params: WatermarkTextParams, value: string): boolean {
  if (value === "transparent") return params.borderOpacity === 0 || params.borderWidth === 0;
  return params.borderOpacity > 0 && params.borderWidth > 0 && normalizeColor(params.borderColor) === value;
}

function applyBackgroundSwatch(params: WatermarkTextParams, value: string): Partial<WatermarkTextParams> {
  if (value === "transparent") {
    return { backgroundOpacity: 0 };
  }
  return {
    backgroundColor: value,
    backgroundOpacity: params.backgroundOpacity > 0 ? params.backgroundOpacity : 1
  };
}

function applyBorderSwatch(params: WatermarkTextParams, value: string, borderWidthFallback: number): Partial<WatermarkTextParams> {
  if (value === "transparent") {
    return { borderOpacity: 0 };
  }
  return {
    borderColor: value,
    borderOpacity: params.borderOpacity > 0 ? params.borderOpacity : 1,
    borderWidth: params.borderWidth > 0 ? params.borderWidth : borderWidthFallback
  };
}

function normalizeColor(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation: number): number {
  return normalizeAngle(rotation);
}
