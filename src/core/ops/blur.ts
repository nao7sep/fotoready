import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import { applyComposite, assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromConcealRegion, validateConcealRegionList } from "./_conceal-shapes";

type BlurParams = {
  rects: ConcealRegion[];
  radius: number;
};

const blurModule: OpModule<BlurParams> = {
  type: "blur",
  label: "Blur",
  category: "Conceal",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_CONCEAL_REGION], radius: 20 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "radius"], "blur.params");
    return {
      rects: validateConcealRegionList(record.rects, "blur.params.rects"),
      radius: assertFiniteNumber(record.radius, "blur.params.radius", { min: 0, minExclusive: true })
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      return compositeMaskedOverlayFromConcealRegion(
        image,
        rect,
        ctx.sourceWidth,
        ctx.sourceHeight,
        (regionImage) => regionImage.blur(Math.max(0.3, params.radius))
      );
    }));
    return applyComposite(image, overlays);
  }
};

registerOp(blurModule);
