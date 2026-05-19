import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import { assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromConcealRegion, validateConcealRegionList } from "./_conceal-shapes";

type ConcealPixelateParams = {
  rects: ConcealRegion[];
  blockSize: number;
};

const concealPixelateModule: OpModule<ConcealPixelateParams> = {
  type: "conceal-pixelate",
  label: "Conceal Pixelate",
  category: "Conceal",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_CONCEAL_REGION], blockSize: 0.016 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "blockSize"], "conceal-pixelate.params");
    return {
      rects: validateConcealRegionList(record.rects, "conceal-pixelate.params.rects"),
      blockSize: normalizeBlockSize(assertFiniteNumber(record.blockSize, "conceal-pixelate.params.blockSize", { min: 0, minExclusive: true }))
    };
  },
  async apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const blockSize = Math.max(2, Math.round(params.blockSize * longEdge));
    const overlays = await Promise.all(params.rects.map(async (rect) => {
      return compositeMaskedOverlayFromConcealRegion(
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

registerOp(concealPixelateModule);

function normalizeBlockSize(blockSize: number): number {
  return blockSize > 1 ? blockSize / 1000 : blockSize;
}
