import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import { assertFiniteNumber, assertNonEmptyString, assertParamsShape } from "./_shared";
import { fillOverlayFromConcealRegion, validateConcealRegionList } from "./_conceal-shapes";

type ConcealFillParams = {
  rects: ConcealRegion[];
  color: string;
  opacity: number;
};

const concealFillModule: OpModule<ConcealFillParams> = {
  type: "conceal-fill",
  label: "Conceal Fill",
  category: "Conceal",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_CONCEAL_REGION], color: "#000000", opacity: 1 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "color", "opacity"], "conceal-fill.params");
    return {
      rects: validateConcealRegionList(record.rects, "conceal-fill.params.rects"),
      color: assertNonEmptyString(record.color, "conceal-fill.params.color"),
      opacity: assertFiniteNumber(record.opacity, "conceal-fill.params.opacity", { min: 0, max: 1 })
    };
  },
  apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    return image.composite(params.rects.map((rect) => fillOverlayFromConcealRegion(
      rect,
      ctx.sourceWidth,
      ctx.sourceHeight,
      rgbaFromColor(params.color, params.opacity)
    )));
  }
};

registerOp(concealFillModule);

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
