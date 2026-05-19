import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_REDACTION_REGION, type RedactionRegion } from "@shared/types/redaction";
import { assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromRedactionRegion, validateRedactionRegionList } from "./_redaction-shapes";

type RedactPixelateParams = {
  rects: RedactionRegion[];
  blockSize: number;
};

const redactPixelateModule: OpModule<RedactPixelateParams> = {
  type: "redact-pixelate",
  label: "Pixelate Redaction",
  category: "Redaction",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_REDACTION_REGION], blockSize: 0.016 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "blockSize"], "redact-pixelate.params");
    return {
      rects: validateRedactionRegionList(record.rects, "redact-pixelate.params.rects"),
      blockSize: normalizeBlockSize(assertFiniteNumber(record.blockSize, "redact-pixelate.params.blockSize", { min: 0, minExclusive: true }))
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const blockSize = Math.max(2, Math.round(params.blockSize * longEdge));
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      return compositeMaskedOverlayFromRedactionRegion(
        image,
        rect,
        ctx.sourceWidth,
        ctx.sourceHeight,
        (regionImage, size) => {
          const tinyWidth = Math.max(1, Math.ceil(size.width / blockSize));
          const tinyHeight = Math.max(1, Math.ceil(size.height / blockSize));
          return regionImage
            .resize(tinyWidth, tinyHeight, { kernel: "nearest" })
            .resize(size.width, size.height, { kernel: "nearest" });
        }
      );
    }));
    return image.composite(overlays);
  }
};

registerOp(redactPixelateModule);

function normalizeBlockSize(blockSize: number): number {
  return blockSize > 1 ? blockSize / 1000 : blockSize;
}
