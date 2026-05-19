import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_REDACTION_REGION, type RedactionRegion } from "@shared/types/redaction";
import { assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromRedactionRegion, validateRedactionRegionList } from "./_redaction-shapes";

type RedactBlurParams = {
  rects: RedactionRegion[];
  radius: number;
};

const redactBlurModule: OpModule<RedactBlurParams> = {
  type: "redact-blur",
  label: "Blur Redaction",
  category: "Redaction",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_REDACTION_REGION], radius: 20 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "radius"], "redact-blur.params");
    return {
      rects: validateRedactionRegionList(record.rects, "redact-blur.params.rects"),
      radius: assertFiniteNumber(record.radius, "redact-blur.params.radius", { min: 0, minExclusive: true })
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      return compositeMaskedOverlayFromRedactionRegion(
        image,
        rect,
        ctx.sourceWidth,
        ctx.sourceHeight,
        (regionImage) => regionImage.blur(Math.max(0.3, params.radius))
      );
    }));
    return image.composite(overlays);
  }
};

registerOp(redactBlurModule);
