import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { ANCHORS, anchorPosition, assertFiniteNumber, assertNonEmptyString, assertOneOf, assertParamsShape, assertString, escapeXml } from "./_shared";

type WatermarkTextParams = {
  text: string;
  anchor: (typeof ANCHORS)[number];
  marginX: number;
  marginY: number;
  opacity: number;
  font: string;
  size: number;
  color: string;
};

const watermarkTextModule: OpModule<WatermarkTextParams> = {
  type: "watermark-text",
  label: "Text Watermark",
  category: "Watermark",
  previewBehavior: "show-input",
  defaultParams: {
    text: "",
    anchor: "bottom-right",
    marginX: 0.02,
    marginY: 0.02,
    opacity: 0.7,
    font: "system",
    size: 0.03,
    color: "#ffffff"
  },
  validate(value) {
    const record = assertParamsShape(value, ["text", "anchor", "marginX", "marginY", "opacity", "font", "size", "color"], "watermark-text.params");
    return {
      text: assertString(record.text, "watermark-text.params.text"),
      anchor: assertOneOf(record.anchor, "watermark-text.params.anchor", ANCHORS),
      marginX: assertFiniteNumber(record.marginX, "watermark-text.params.marginX", { min: 0, max: 1 }),
      marginY: assertFiniteNumber(record.marginY, "watermark-text.params.marginY", { min: 0, max: 1 }),
      opacity: assertFiniteNumber(record.opacity, "watermark-text.params.opacity", { min: 0, max: 1 }),
      font: assertNonEmptyString(record.font, "watermark-text.params.font"),
      size: assertFiniteNumber(record.size, "watermark-text.params.size", { min: 0, max: 1, minExclusive: true }),
      color: assertNonEmptyString(record.color, "watermark-text.params.color")
    };
  },
  apply(image, params, ctx) {
    if (!params.text.trim()) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const fontSize = Math.max(8, Math.round(params.size * longEdge));
    const marginX = Math.round(params.marginX * longEdge);
    const marginY = Math.round(params.marginY * longEdge);
    const svgWidth = Math.min(ctx.sourceWidth, Math.max(fontSize * 4, params.text.length * fontSize));
    const svgHeight = Math.ceil(fontSize * 1.6);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
  <text x="0" y="${Math.round(fontSize * 1.15)}" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize}" fill="${escapeXml(params.color)}" fill-opacity="${params.opacity}">${escapeXml(params.text)}</text>
</svg>`;
    const { left, top } = anchorPosition(params.anchor, ctx.sourceWidth, ctx.sourceHeight, svgWidth, svgHeight, marginX, marginY);
    return image.composite([{ input: Buffer.from(svg), left, top }]);
  }
};

registerOp(watermarkTextModule);
