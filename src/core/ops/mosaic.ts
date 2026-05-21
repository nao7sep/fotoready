import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { DEFAULT_CONCEAL_REGION, type ConcealRegion } from "@shared/types/conceal";
import { applyComposite, assertFiniteNumber, assertParamsShape } from "./_shared";
import { compositeMaskedOverlayFromConcealRegion, validateConcealRegionList } from "./_conceal-shapes";
import sharp from "sharp";

type MosaicParams = {
  rects: ConcealRegion[];
  blockSize: number;
};

const mosaicModule: OpModule<MosaicParams> = {
  type: "mosaic",
  label: "Mosaic",
  category: "Conceal",
  previewBehavior: "show-output",
  defaultParams: { rects: [DEFAULT_CONCEAL_REGION], blockSize: 0.016 },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "blockSize"], "mosaic.params");
    return {
      rects: validateConcealRegionList(record.rects, "mosaic.params.rects"),
      blockSize: assertFiniteNumber(record.blockSize, "mosaic.params.blockSize", { min: 0, max: 1, minExclusive: true })
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
        (regionImage, size) => pixelateRegion(regionImage, size, blockSize)
      );
    }));
    return applyComposite(image, overlays);
  }
};

registerOp(mosaicModule);

async function pixelateRegion(
  regionImage: sharp.Sharp,
  size: { width: number; height: number },
  blockSize: number
): Promise<sharp.Sharp> {
  const sharpImpl = (await import("sharp")).default;
  const { data, info } = await regionImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  const width = info.width;
  const height = info.height;
  const channels = info.channels;

  for (let blockTop = 0; blockTop < size.height; blockTop += blockSize) {
    const blockHeight = Math.min(blockSize, size.height - blockTop);
    for (let blockLeft = 0; blockLeft < size.width; blockLeft += blockSize) {
      const blockWidth = Math.min(blockSize, size.width - blockLeft);
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          const index = ((blockTop + y) * width + (blockLeft + x)) * channels;
          sums[0] += pixels[index] ?? 0;
          sums[1] += pixels[index + 1] ?? 0;
          sums[2] += pixels[index + 2] ?? 0;
          sums[3] += pixels[index + 3] ?? 255;
          count += 1;
        }
      }
      const fill = sums.map((sum) => Math.round(sum / Math.max(1, count)));
      for (let y = 0; y < blockHeight; y += 1) {
        for (let x = 0; x < blockWidth; x += 1) {
          const index = ((blockTop + y) * width + (blockLeft + x)) * channels;
          pixels[index] = fill[0] ?? 0;
          pixels[index + 1] = fill[1] ?? 0;
          pixels[index + 2] = fill[2] ?? 0;
          pixels[index + 3] = fill[3] ?? 255;
        }
      }
    }
  }

  return sharpImpl(pixels, { raw: { width, height, channels } });
}
