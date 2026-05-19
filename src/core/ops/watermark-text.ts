import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import sharp from "sharp";
import { estimateWatermarkTextLayout } from "@shared/watermark-text-layout";
import { applyTransformedOverlay, assertFiniteNumber, assertNonEmptyString, assertParamsShape, escapeXml } from "./_shared";

type WatermarkTextParams = {
  text: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  size: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  bold: boolean;
  italic: boolean;
};

const watermarkTextModule: OpModule<WatermarkTextParams> = {
  type: "watermark-text",
  label: "Text watermark",
  pickerLabel: "Text",
  category: "Watermark",
  previewBehavior: "show-output",
  defaultParams: {
    text: "Watermark",
    x: 0.74,
    y: 0.9,
    rotation: 0,
    opacity: 0.7,
    size: 0.03,
    color: "#ffffff",
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    bold: false,
    italic: false
  },
  validate(value) {
    const record = assertParamsShape(value, ["text", "x", "y", "rotation", "opacity", "size", "color", "backgroundColor", "backgroundOpacity", "bold", "italic"], "watermark-text.params");
    return {
      text: typeof record.text === "string" ? record.text : "",
      x: assertFiniteNumber(record.x, "watermark-text.params.x", { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, "watermark-text.params.y", { min: 0, max: 1 }),
      rotation: assertFiniteNumber(record.rotation, "watermark-text.params.rotation", { min: -180, max: 180 }),
      opacity: assertFiniteNumber(record.opacity, "watermark-text.params.opacity", { min: 0, max: 1 }),
      size: assertFiniteNumber(record.size, "watermark-text.params.size", { min: 0, max: 1, minExclusive: true }),
      color: assertNonEmptyString(record.color, "watermark-text.params.color"),
      backgroundColor: assertNonEmptyString(record.backgroundColor, "watermark-text.params.backgroundColor"),
      backgroundOpacity: assertFiniteNumber(record.backgroundOpacity, "watermark-text.params.backgroundOpacity", { min: 0, max: 1 }),
      bold: typeof record.bold === "boolean" ? record.bold : false,
      italic: typeof record.italic === "boolean" ? record.italic : false
    };
  },
  async apply(image, params, ctx) {
    if (!params.text.trim()) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const fontSize = Math.max(8, Math.round(params.size * longEdge));
    const layout = estimateWatermarkTextLayout(params.text, fontSize, params.bold, params.italic);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">
  <rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${escapeXml(params.backgroundColor)}" fill-opacity="${params.backgroundOpacity}" />
  <text x="${layout.paddingX}" y="${layout.baselineY}" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize}" font-style="${params.italic ? "italic" : "normal"}" font-weight="${params.bold ? "700" : "400"}" fill="${escapeXml(params.color)}" fill-opacity="${params.opacity}">${escapeXml(params.text)}</text>
</svg>`;
    return applyTransformedOverlay(image, sharp(Buffer.from(svg)), {
      left: params.x * longEdge,
      top: params.y * longEdge,
      width: layout.width,
      height: layout.height,
      rotation: params.rotation
    });
  }
};

registerOp(watermarkTextModule);
