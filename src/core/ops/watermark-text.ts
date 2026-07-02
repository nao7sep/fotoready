import type * as sharp from "sharp";
import { registerOp } from "./registry";
import { DEFAULT_TEXT_WATERMARK_FONT_FAMILY } from "@shared/watermark-text-layout";
import type { OpModule } from "./op-module";
import { applyComposite, applyTransformedOverlay, assertFiniteNumber, assertNonEmptyString, assertParamsShape, escapeXml } from "./_shared";

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

type TrimmedTextBitmap = {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
};

const MAX_FITTED_TEXT_BITMAP_CACHE_ENTRIES = 96;
const MAX_RENDERED_TEXT_BITMAP_CACHE_ENTRIES = 256;
const fittedTextBitmapCache = new Map<string, TrimmedTextBitmap>();
const renderedTextBitmapCache = new Map<string, TrimmedTextBitmap>();

const watermarkTextModule: OpModule<WatermarkTextParams> = {
  type: "watermark-text",
  label: "Text watermark",
  pickerLabel: "Text",
  category: "Watermark",
  previewBehavior: "show-output",
  defaultParams: {
    text: "Watermark",
    x: 0.62,
    y: 0.84,
    w: 0.22,
    h: 0.08,
    rotation: 0,
    opacity: 0.7,
    fontFamily: DEFAULT_TEXT_WATERMARK_FONT_FAMILY,
    color: "#ffffff",
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    paddingX: 0.012,
    paddingY: 0.008,
    cornerRadius: 0.01,
    borderColor: "#ffffff",
    borderOpacity: 0,
    borderWidth: 0
  },
  validate(value) {
    const record = assertParamsShape(
      value,
      [
        "text", "x", "y", "w", "h", "rotation", "opacity", "fontFamily", "color",
        "backgroundColor", "backgroundOpacity", "bold", "italic", "underline",
        "strikeThrough", "paddingX", "paddingY", "cornerRadius", "borderColor",
        "borderOpacity", "borderWidth"
      ],
      "watermark-text.params"
    );
    return {
      text: typeof record.text === "string" ? record.text : "",
      x: assertFiniteNumber(record.x, "watermark-text.params.x", { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, "watermark-text.params.y", { min: 0, max: 1 }),
      w: assertFiniteNumber(record.w, "watermark-text.params.w", { min: 0, max: 1, minExclusive: true }),
      h: assertFiniteNumber(record.h, "watermark-text.params.h", { min: 0, max: 1, minExclusive: true }),
      rotation: assertFiniteNumber(record.rotation, "watermark-text.params.rotation", { min: -180, max: 180 }),
      opacity: assertFiniteNumber(record.opacity, "watermark-text.params.opacity", { min: 0, max: 1 }),
      fontFamily: assertNonEmptyString(record.fontFamily, "watermark-text.params.fontFamily"),
      color: assertNonEmptyString(record.color, "watermark-text.params.color"),
      backgroundColor: assertNonEmptyString(record.backgroundColor, "watermark-text.params.backgroundColor"),
      backgroundOpacity: assertFiniteNumber(record.backgroundOpacity, "watermark-text.params.backgroundOpacity", { min: 0, max: 1 }),
      bold: typeof record.bold === "boolean" ? record.bold : false,
      italic: typeof record.italic === "boolean" ? record.italic : false,
      underline: typeof record.underline === "boolean" ? record.underline : false,
      strikeThrough: typeof record.strikeThrough === "boolean" ? record.strikeThrough : false,
      paddingX: assertFiniteNumber(record.paddingX, "watermark-text.params.paddingX", { min: 0, max: 1 }),
      paddingY: assertFiniteNumber(record.paddingY, "watermark-text.params.paddingY", { min: 0, max: 1 }),
      cornerRadius: assertFiniteNumber(record.cornerRadius, "watermark-text.params.cornerRadius", { min: 0, max: 1 }),
      borderColor: assertNonEmptyString(record.borderColor, "watermark-text.params.borderColor"),
      borderOpacity: assertFiniteNumber(record.borderOpacity, "watermark-text.params.borderOpacity", { min: 0, max: 1 }),
      borderWidth: assertFiniteNumber(record.borderWidth, "watermark-text.params.borderWidth", { min: 0, max: 1 })
    };
  },
  async apply(image, params, ctx) {
    if (!params.text.trim()) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const boxWidth = Math.max(1, Math.round(params.w * longEdge));
    const boxHeight = Math.max(1, Math.round(params.h * longEdge));
    const borderWidth = Math.max(0, Math.round(params.borderWidth * longEdge));
    const paddingX = Math.max(0, Math.round(params.paddingX * longEdge));
    const paddingY = Math.max(0, Math.round(params.paddingY * longEdge));
    const cornerRadius = Math.max(0, Math.round(params.cornerRadius * longEdge));
    const innerLeft = Math.min(boxWidth - 1, borderWidth + paddingX);
    const innerTop = Math.min(boxHeight - 1, borderWidth + paddingY);
    const innerWidth = Math.max(1, boxWidth - innerLeft * 2);
    const innerHeight = Math.max(1, boxHeight - innerTop * 2);
    const textBitmap = await fitTextBitmap(params, innerWidth, innerHeight);
    const sharpImpl = (await import("sharp")).default;
    let overlay = sharpImpl({
      create: {
        width: boxWidth,
        height: boxHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    });
    const overlays: sharp.OverlayOptions[] = [];
    const backgroundSvg = renderWatermarkBoxSvg(boxWidth, boxHeight, cornerRadius, params.backgroundColor, params.backgroundOpacity, params.borderColor, params.borderOpacity, borderWidth);
    if (backgroundSvg) {
      overlays.push({ input: Buffer.from(backgroundSvg) });
    }
    overlays.push({
      input: textBitmap.data,
      raw: { width: textBitmap.width, height: textBitmap.height, channels: textBitmap.channels },
      left: innerLeft + Math.round((innerWidth - textBitmap.width) / 2),
      top: innerTop + Math.round((innerHeight - textBitmap.height) / 2)
    });
    overlay = (await applyComposite(overlay, overlays)).image;
    return applyTransformedOverlay(image, overlay, {
      left: params.x * longEdge,
      top: params.y * longEdge,
      width: boxWidth,
      height: boxHeight,
      rotation: params.rotation
    });
  }
};

registerOp(watermarkTextModule);

async function fitTextBitmap(params: WatermarkTextParams, maxWidth: number, maxHeight: number): Promise<TrimmedTextBitmap> {
  const cacheKey = `${textBitmapStyleKey(params)}|fit|${maxWidth}x${maxHeight}`;
  const cached = getCachedBitmap(fittedTextBitmapCache, cacheKey);
  if (cached) {
    return cached;
  }

  let low = 1;
  let high = Math.max(1, Math.ceil(Math.max(maxWidth, maxHeight) * 1.5));
  let best: TrimmedTextBitmap | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = await renderTrimmedTextBitmap(params, mid);
    if (candidate.width <= maxWidth && candidate.height <= maxHeight) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const bitmap = best ?? await renderTrimmedTextBitmap(params, 1);
  setCachedBitmap(fittedTextBitmapCache, cacheKey, bitmap, MAX_FITTED_TEXT_BITMAP_CACHE_ENTRIES);
  return cloneTrimmedTextBitmap(bitmap);
}

async function renderTrimmedTextBitmap(params: WatermarkTextParams, fontSize: number): Promise<TrimmedTextBitmap> {
  const cacheKey = `${textBitmapStyleKey(params)}|render|${fontSize}`;
  const cached = getCachedBitmap(renderedTextBitmapCache, cacheKey);
  if (cached) {
    return cached;
  }

  const sharpImpl = (await import("sharp")).default;
  const characters = Math.max(1, Array.from(params.text).length);
  const margin = Math.max(4, Math.ceil(fontSize * 1.5));
  const width = Math.max(margin * 2 + fontSize * 2, Math.ceil(characters * fontSize * 2.4) + margin * 2);
  const height = Math.max(margin * 2 + fontSize * 3, Math.ceil(fontSize * 4));
  const decorations = [params.underline ? "underline" : "", params.strikeThrough ? "line-through" : ""].filter(Boolean).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text
    x="${margin}"
    y="${margin + fontSize}"
    font-family="${escapeXml(params.fontFamily)}"
    font-size="${fontSize}"
    font-style="${params.italic ? "italic" : "normal"}"
    font-weight="${params.bold ? "700" : "400"}"
    text-decoration="${escapeXml(decorations)}"
    fill="${escapeXml(params.color)}"
    fill-opacity="${params.opacity}"
  >${escapeXml(params.text)}</text>
</svg>`;
  const rendered = await sharpImpl(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(rendered.data, rendered.info.width, rendered.info.height, rendered.info.channels);
  if (!bounds) {
    const empty = { data: Buffer.from([0, 0, 0, 0]), width: 1, height: 1, channels: 4 } as const;
    setCachedBitmap(renderedTextBitmapCache, cacheKey, empty, MAX_RENDERED_TEXT_BITMAP_CACHE_ENTRIES);
    return cloneTrimmedTextBitmap(empty);
  }
  const trimmed = await sharpImpl(rendered.data, {
    raw: {
      width: rendered.info.width,
      height: rendered.info.height,
      channels: rendered.info.channels
    }
  })
    .extract(bounds)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bitmap = {
    data: Buffer.from(trimmed.data),
    width: trimmed.info.width,
    height: trimmed.info.height,
    channels: 4
  } as const;
  setCachedBitmap(renderedTextBitmapCache, cacheKey, bitmap, MAX_RENDERED_TEXT_BITMAP_CACHE_ENTRIES);
  return cloneTrimmedTextBitmap(bitmap);
}

function renderWatermarkBoxSvg(
  width: number,
  height: number,
  cornerRadius: number,
  backgroundColor: string,
  backgroundOpacity: number,
  borderColor: string,
  borderOpacity: number,
  borderWidth: number
): string | null {
  if (backgroundOpacity <= 0 && (borderOpacity <= 0 || borderWidth <= 0)) {
    return null;
  }
  const inset = borderWidth > 0 ? borderWidth / 2 : 0;
  const rectWidth = Math.max(1, width - inset * 2);
  const rectHeight = Math.max(1, height - inset * 2);
  const radius = Math.max(0, Math.min(cornerRadius, rectWidth / 2, rectHeight / 2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect
    x="${inset}"
    y="${inset}"
    width="${rectWidth}"
    height="${rectHeight}"
    rx="${radius}"
    ry="${radius}"
    fill="${escapeXml(backgroundColor)}"
    fill-opacity="${backgroundOpacity}"
    stroke="${escapeXml(borderColor)}"
    stroke-opacity="${borderOpacity}"
    stroke-width="${borderWidth}"
  />
</svg>`;
}

function alphaBounds(data: Buffer, width: number, height: number, channels: number): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3] ?? 0;
      if (alpha <= 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function textBitmapStyleKey(params: WatermarkTextParams): string {
  return JSON.stringify({
    text: params.text,
    fontFamily: params.fontFamily,
    opacity: params.opacity,
    color: params.color,
    bold: params.bold,
    italic: params.italic,
    underline: params.underline,
    strikeThrough: params.strikeThrough
  });
}

function getCachedBitmap(cache: Map<string, TrimmedTextBitmap>, key: string): TrimmedTextBitmap | null {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return cloneTrimmedTextBitmap(value);
}

function setCachedBitmap(cache: Map<string, TrimmedTextBitmap>, key: string, bitmap: TrimmedTextBitmap, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, cloneTrimmedTextBitmap(bitmap));
  if (cache.size <= maxEntries) return;
  const oldestKey = cache.keys().next().value;
  if (typeof oldestKey === "string") {
    cache.delete(oldestKey);
  }
}

function cloneTrimmedTextBitmap(bitmap: TrimmedTextBitmap): TrimmedTextBitmap {
  return {
    data: Buffer.from(bitmap.data),
    width: bitmap.width,
    height: bitmap.height,
    channels: bitmap.channels
  };
}
