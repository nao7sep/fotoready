import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { ANCHORS, anchorPosition, assertFiniteNumber, assertOneOf, assertParamsShape, assertString } from "./_shared";

type WatermarkImageParams = {
  pngPath: string;
  anchor: (typeof ANCHORS)[number];
  marginX: number;
  marginY: number;
  opacity: number;
  scale: number;
};

const watermarkImageModule: OpModule<WatermarkImageParams> = {
  type: "watermark-image",
  label: "Image Watermark",
  category: "Watermark",
  previewBehavior: "show-input",
  defaultParams: {
    pngPath: "",
    anchor: "bottom-right",
    marginX: 0.02,
    marginY: 0.02,
    opacity: 0.7,
    scale: 0.15
  },
  validate(value) {
    const record = assertParamsShape(value, ["pngPath", "anchor", "marginX", "marginY", "opacity", "scale"], "watermark-image.params");
    return {
      pngPath: assertString(record.pngPath, "watermark-image.params.pngPath"),
      anchor: assertOneOf(record.anchor, "watermark-image.params.anchor", ANCHORS),
      marginX: assertFiniteNumber(record.marginX, "watermark-image.params.marginX", { min: 0, max: 1 }),
      marginY: assertFiniteNumber(record.marginY, "watermark-image.params.marginY", { min: 0, max: 1 }),
      opacity: assertFiniteNumber(record.opacity, "watermark-image.params.opacity", { min: 0, max: 1 }),
      scale: assertFiniteNumber(record.scale, "watermark-image.params.scale", { min: 0, max: 1, minExclusive: true })
    };
  },
  async apply(image, params, ctx) {
    if (!params.pngPath) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const width = Math.max(1, Math.round(longEdge * params.scale));
    const marginX = Math.round(params.marginX * longEdge);
    const marginY = Math.round(params.marginY * longEdge);
    const sharpImpl = (await import("sharp")).default;
    const watermark = await sharpImpl(params.pngPath)
      .resize({ width, withoutEnlargement: true })
      .ensureAlpha()
      .modulate({ brightness: params.opacity })
      .toBuffer({ resolveWithObject: true });
    const { left, top } = anchorPosition(params.anchor, ctx.sourceWidth, ctx.sourceHeight, watermark.info.width, watermark.info.height, marginX, marginY);
    return image.composite([{ input: watermark.data, left, top }]);
  }
};

registerOp(watermarkImageModule);
