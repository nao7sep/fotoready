import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_REDACTION_REGION, type RedactionRegion } from "@shared/types/redaction";
import { assertFiniteNumber, assertNonEmptyString, assertParamsShape } from "./_shared";
import { fillOverlayFromRedactionRegion, validateRedactionRegionList } from "./_redaction-shapes";

type RedactFillParams = {
  rects: RedactionRegion[];
  color: string;
  opacity: number;
};

const redactFillModule: OpModule<RedactFillParams> = {
  type: "redact-fill",
  label: "Fill Redaction",
  category: "Redaction",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_REDACTION_REGION], color: "#000000", opacity: 1 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "color", "opacity"], "redact-fill.params");
    return {
      rects: validateRedactionRegionList(record.rects, "redact-fill.params.rects"),
      color: assertNonEmptyString(record.color, "redact-fill.params.color"),
      opacity: assertFiniteNumber(record.opacity, "redact-fill.params.opacity", { min: 0, max: 1 })
    };
  },
  apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    return image.composite(params.rects.map((rect) => fillOverlayFromRedactionRegion(
      rect,
      ctx.sourceWidth,
      ctx.sourceHeight,
      rgbaFromColor(params.color, params.opacity)
    )));
  }
};

registerOp(redactFillModule);

function rgbaFromColor(color: string, opacity: number): string {
  const normalized = color.trim();
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return `rgba(0, 0, 0, ${opacity.toFixed(3)})`;
  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity.toFixed(3)})`;
}
