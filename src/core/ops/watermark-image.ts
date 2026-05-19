import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { applyTransformedOverlay, assertFiniteNumber, assertParamsShape, assertString } from "./_shared";

type WatermarkImageParams = {
  pngPath: string;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

const watermarkImageModule: OpModule<WatermarkImageParams> = {
  type: "watermark-image",
  label: "Image Watermark",
  category: "Watermark",
  previewBehavior: "show-output",
  defaultParams: {
    pngPath: "",
    x: 0.74,
    y: 0.82,
    opacity: 0.7,
    scale: 0.15,
    rotation: 0
  },
  validate(value) {
    const record = assertParamsShape(value, ["pngPath", "x", "y", "opacity", "scale", "rotation"], "watermark-image.params");
    return {
      pngPath: assertString(record.pngPath, "watermark-image.params.pngPath"),
      x: assertFiniteNumber(record.x, "watermark-image.params.x", { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, "watermark-image.params.y", { min: 0, max: 1 }),
      opacity: assertFiniteNumber(record.opacity, "watermark-image.params.opacity", { min: 0, max: 1 }),
      scale: assertFiniteNumber(record.scale, "watermark-image.params.scale", { min: 0, max: 1, minExclusive: true }),
      rotation: assertFiniteNumber(record.rotation, "watermark-image.params.rotation", { min: -180, max: 180 })
    };
  },
  async apply(image, params, ctx) {
    if (!params.pngPath) return image;
    const longEdge = Math.max(ctx.sourceWidth, ctx.sourceHeight);
    const sharpImpl = (await import("sharp")).default;
    const width = Math.max(1, Math.round(longEdge * params.scale));
    const rendered = await sharpImpl(params.pngPath)
      .resize({ width, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = Buffer.from(rendered.data);
    for (let index = 3; index < pixels.length; index += rendered.info.channels) {
      pixels[index] = Math.round((pixels[index] ?? 255) * params.opacity);
    }
    const watermark = sharpImpl(pixels, {
      raw: {
        width: rendered.info.width,
        height: rendered.info.height,
        channels: rendered.info.channels
      }
    });
    return applyTransformedOverlay(image, watermark, {
      left: params.x * longEdge,
      top: params.y * longEdge,
      width: rendered.info.width,
      height: rendered.info.height,
      rotation: params.rotation
    });
  }
};

registerOp(watermarkImageModule);
