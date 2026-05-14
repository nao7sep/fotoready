import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, regionFromRect, validateRectList } from "./_shared";

type RedactPixelateParams = {
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  blockSize: number;
};

const redactPixelateModule: OpModule<RedactPixelateParams> = {
  type: "redact-pixelate",
  label: "Pixelate Redaction",
  category: "Redaction",
  previewBehavior: "show-input",
  defaultParams: { rects: [], blockSize: 16 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "blockSize"], "redact-pixelate.params");
    return {
      rects: validateRectList(record.rects, "redact-pixelate.params.rects"),
      blockSize: assertFiniteNumber(record.blockSize, "redact-pixelate.params.blockSize", { min: 0, minExclusive: true })
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const blockSize = Math.max(2, Math.round(params.blockSize * longEdge));
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      const region = regionFromRect(rect, ctx.sourceWidth, ctx.sourceHeight);
      const tinyWidth = Math.max(1, Math.ceil(region.width / blockSize));
      const tinyHeight = Math.max(1, Math.ceil(region.height / blockSize));
      const input = await image
        .clone()
        .extract(region)
        .resize(tinyWidth, tinyHeight, { kernel: "nearest" })
        .resize(region.width, region.height, { kernel: "nearest" })
        .toBuffer();
      return { input, left: region.left, top: region.top };
    }));
    return image.composite(overlays);
  }
};

registerOp(redactPixelateModule);
