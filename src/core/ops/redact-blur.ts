import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, compositeOverlayFromRegion, regionFromRect, validateRectList } from "./_shared";

type RedactBlurParams = {
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  radius: number;
};

const redactBlurModule: OpModule<RedactBlurParams> = {
  type: "redact-blur",
  label: "Blur Redaction",
  category: "Redaction",
  previewBehavior: "show-output",
  defaultParams: { rects: [], radius: 20 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "radius"], "redact-blur.params");
    return {
      rects: validateRectList(record.rects, "redact-blur.params.rects"),
      radius: assertFiniteNumber(record.radius, "redact-blur.params.radius", { min: 0, minExclusive: true })
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      const region = regionFromRect(rect, ctx.sourceWidth, ctx.sourceHeight);
      return compositeOverlayFromRegion(image, region, (regionImage) => regionImage.blur(Math.max(0.3, params.radius)));
    }));
    return image.composite(overlays);
  }
};

registerOp(redactBlurModule);
