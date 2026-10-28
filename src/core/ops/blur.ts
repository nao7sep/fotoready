import { MIN_BLUR_SIGMA } from "@shared/op-limits";
import type { OpModule } from "./op-module";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import { applyComposite, assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromConcealRegion, validateConcealRegionList } from "./_conceal-shapes";

type BlurParams = {
  rects: ConcealRegion[];
  radius: number;
};

export const blurModule: OpModule<BlurParams> = {
  type: "blur",
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
    // One region at a time: three regions on a 24 MP photo took about 150 ms whether they ran together or in turn.
    const overlays = [];
    for (const rect of params.rects) {
      overlays.push(await compositeMaskedOverlayFromConcealRegion(image, rect, ctx.sourceWidth, ctx.sourceHeight,
        (regionImage) => regionImage.blur(Math.max(MIN_BLUR_SIGMA, params.radius))));
    }
    return applyComposite(image, overlays);
  }
};
