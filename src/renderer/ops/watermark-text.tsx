import React, { useId } from "react";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY, TEXT_WATERMARK_FONT_OPTIONS } from "@shared/watermark-text-layout";
import { InteractiveOverlayRect } from "@renderer/components/canvas/interactive-overlays";
import type { OpRenderer } from "./op-renderer";
import { AngleControl, normalizeAngle } from "./_angle-controls";
import { fractionToPixels, onePixelStep, pixelsToFraction, sliderLongEdge } from "./_slider-units";

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
    const minBoxSize = Math.max(12, fractionToPixels(0.02, longEdge));
    const xMax = fractionToPixels(Math.max(0, imageBounds.maxX - params.w), longEdge);
    const yMax = fractionToPixels(Math.max(0, imageBounds.maxY - params.h), longEdge);
    const widthMax = Math.max(minBoxSize, fractionToPixels(Math.max(0.02, imageBounds.maxX - params.x), longEdge));
    const heightMax = Math.max(minBoxSize, fractionToPixels(Math.max(0.02, imageBounds.maxY - params.y), longEdge));
    const borderWidthFallback = Math.max(params.borderWidth, onePixelStep(longEdge));

    function patchBox(patch: Partial<WatermarkTextParams>): void {
      onParamsChange(clampTextWatermarkBox({ ...params, ...patch }, imageBounds, 0.02));
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
        <label className="stacked-field">
          Font family
          <input
            className="compact-control"
            disabled={disabled}
            list={fontFamilyListId}
            placeholder={DEFAULT_TEXT_WATERMARK_FONT_FAMILY}
            type="text"
            value={params.fontFamily}
            onChange={(event) => onParamChange("fontFamily", event.currentTarget.value || DEFAULT_TEXT_WATERMARK_FONT_FAMILY)}
          />
          <datalist id={fontFamilyListId}>
            {TEXT_WATERMARK_FONT_OPTIONS.map((option) => (
              <option key={option.label} label={option.label} value={option.value} />
            ))}
          </datalist>
        </label>
        <div className="watermark-style-row">
          <button className={`toolbar-button compact-text ${params.bold ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("bold", !params.bold)}>Bold</button>
          <button className={`toolbar-button compact-text ${params.italic ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("italic", !params.italic)}>Italic</button>
          <button className={`toolbar-button compact-text ${params.underline ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("underline", !params.underline)}>Underline</button>
          <button className={`toolbar-button compact-text ${params.strikeThrough ? "active" : ""}`} disabled={disabled} type="button" onClick={() => onParamChange("strikeThrough", !params.strikeThrough)}>Strike</button>
        </div>
        <label className="slider-row">
          <span>Width</span>
          <input
            disabled={disabled}
            max={widthMax}
            min={minBoxSize}
            step={1}
            type="range"
            value={fractionToPixels(params.w, longEdge)}
            onChange={(event) => patchBox({ w: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
          />
          <span className="slider-value">{formatLength(params.w, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Height</span>
          <input
            disabled={disabled}
            max={heightMax}
            min={minBoxSize}
            step={1}
            type="range"
            value={fractionToPixels(params.h, longEdge)}
            onChange={(event) => patchBox({ h: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
          />
          <span className="slider-value">{formatLength(params.h, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>X</span>
          <input
            disabled={disabled}
            max={xMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.x, longEdge)}
            onChange={(event) => patchBox({ x: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
          />
          <span className="slider-value">{formatLength(params.x, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Y</span>
          <input
            disabled={disabled}
            max={yMax}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.y, longEdge)}
            onChange={(event) => patchBox({ y: pixelsToFraction(event.currentTarget.valueAsNumber, longEdge) })}
          />
          <span className="slider-value">{formatLength(params.y, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={params.opacity} onChange={(event) => onParamChange("opacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
        <AngleControl disabled={disabled} value={params.rotation} onChange={(rotation) => onParamChange("rotation", normalizeAngle(rotation))} />
        <label className="control-row">
          <span>Text color</span>
          <input disabled={disabled} type="color" value={params.color} onChange={(event) => onParamChange("color", event.currentTarget.value)} />
        </label>
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Background</span>
          <div className="geometry-swatch-group" role="group" aria-label="Background color">
            {BOX_COLOR_SWATCHES.map((swatch) => (
              <button
                aria-label={`Use ${swatch.label.toLowerCase()} background`}
                className={`color-swatch ${backgroundSwatchActive(params, swatch.value) ? "active" : ""}${swatch.value === "transparent" ? " transparent" : ""}`}
                disabled={disabled}
                key={swatch.key}
                style={swatch.style}
                type="button"
                onClick={() => onParamsChange(applyBackgroundSwatch(params, swatch.value))}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={params.backgroundColor} onChange={(event) => onParamsChange({ backgroundColor: event.currentTarget.value, backgroundOpacity: params.backgroundOpacity > 0 ? params.backgroundOpacity : 1 })} />
            </label>
          </div>
        </div>
        <label className="slider-row">
          <span>Background opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={params.backgroundOpacity} onChange={(event) => onParamChange("backgroundOpacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.backgroundOpacity * 100)}%`}</span>
        </label>
        <div className="geometry-toolbar-row">
          <span className="geometry-status">Border</span>
          <div className="geometry-swatch-group" role="group" aria-label="Border color">
            {BOX_COLOR_SWATCHES.map((swatch) => (
              <button
                aria-label={`Use ${swatch.label.toLowerCase()} border`}
                className={`color-swatch ${borderSwatchActive(params, swatch.value) ? "active" : ""}${swatch.value === "transparent" ? " transparent" : ""}`}
                disabled={disabled}
                key={`border-${swatch.key}`}
                style={swatch.style}
                type="button"
                onClick={() => onParamsChange(applyBorderSwatch(params, swatch.value, borderWidthFallback))}
              />
            ))}
            <label className="color-picker-button">
              <input disabled={disabled} type="color" value={params.borderColor} onChange={(event) => onParamsChange({
                borderColor: event.currentTarget.value,
                borderOpacity: params.borderOpacity > 0 ? params.borderOpacity : 1,
                borderWidth: borderWidthFallback
              })} />
            </label>
          </div>
        </div>
        <label className="slider-row">
          <span>Border opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={params.borderOpacity} onChange={(event) => onParamChange("borderOpacity", event.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.borderOpacity * 100)}%`}</span>
        </label>
        <label className="slider-row">
          <span>Border thickness</span>
          <input
            disabled={disabled}
            max={Math.max(0, fractionToPixels(0.03, longEdge))}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.borderWidth, longEdge)}
            onChange={(event) => onParamChange("borderWidth", pixelsToFraction(event.currentTarget.valueAsNumber, longEdge))}
          />
          <span className="slider-value">{formatLength(params.borderWidth, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Horizontal padding</span>
          <input
            disabled={disabled}
            max={Math.max(0, fractionToPixels(0.08, longEdge))}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.paddingX, longEdge)}
            onChange={(event) => onParamChange("paddingX", pixelsToFraction(event.currentTarget.valueAsNumber, longEdge))}
          />
          <span className="slider-value">{formatLength(params.paddingX, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Vertical padding</span>
          <input
            disabled={disabled}
            max={Math.max(0, fractionToPixels(0.08, longEdge))}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.paddingY, longEdge)}
            onChange={(event) => onParamChange("paddingY", pixelsToFraction(event.currentTarget.valueAsNumber, longEdge))}
          />
          <span className="slider-value">{formatLength(params.paddingY, longEdge)}</span>
        </label>
        <label className="slider-row">
          <span>Corner radius</span>
          <input
            disabled={disabled}
            max={Math.max(0, fractionToPixels(0.08, longEdge))}
            min={0}
            step={1}
            type="range"
            value={fractionToPixels(params.cornerRadius, longEdge)}
            onChange={(event) => onParamChange("cornerRadius", pixelsToFraction(event.currentTarget.valueAsNumber, longEdge))}
          />
          <span className="slider-value">{formatLength(params.cornerRadius, longEdge)}</span>
        </label>
      </div>
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    if (!selected || !params.text.trim()) return null;
    const stageRect = textWatermarkToStageRect(params, ctx);
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
  return clampTextWatermarkBox({
    x: (rect.x - ctx.placement.x) / (ctx.longEdge * ctx.placement.scale),
    y: (rect.y - ctx.placement.y) / (ctx.longEdge * ctx.placement.scale),
    w: rect.w / (ctx.longEdge * ctx.placement.scale),
    h: rect.h / (ctx.longEdge * ctx.placement.scale),
    rotation: normalizeRotation(rect.rotation ?? 0)
  }, ctx.imageBounds, 0.02);
}

function clampTextWatermarkBox<T extends Partial<WatermarkTextParams>>(
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

function formatLength(value: number, longEdge: number | null): string {
  if (longEdge) {
    return `${Math.round(value * longEdge)}px`;
  }
  return `${Math.round(value * 100)}%`;
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
