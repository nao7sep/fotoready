import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, materialize } from "./_shared";
import { cropExtractRegion } from "./_crop-region";

export type CropAspectLock = number | string | null;

type CropParams = {
  x: number;
  y: number;
  w: number;
  h: number;
  aspectLock: CropAspectLock;
};

const cropModule: OpModule<CropParams> = {
  type: "crop",
  label: "Crop",
  category: "Geometry",
  previewBehavior: "show-input",
  defaultParams: { x: 0, y: 0, w: 1, h: 1, aspectLock: null },
  validate(value) {
    const record = assertParamsShape(value, ["x", "y", "w", "h", "aspectLock"], "crop.params");
    return {
      x: assertFiniteNumber(record.x, "crop.params.x", { min: 0, max: 1 }),
      y: assertFiniteNumber(record.y, "crop.params.y", { min: 0, max: 1 }),
      w: assertFiniteNumber(record.w, "crop.params.w", { min: 0, max: 1, minExclusive: true }),
      h: assertFiniteNumber(record.h, "crop.params.h", { min: 0, max: 1, minExclusive: true }),
      aspectLock: validateAspectLock(record.aspectLock)
    };
  },
  async apply(image, params, ctx) {
    return materialize(image.extract(cropExtractRegion(params, ctx.sourceWidth, ctx.sourceHeight)));
  }
};

function validateAspectLock(value: unknown): CropAspectLock {
  if (value === null) return null;
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new Error('crop.params.aspectLock must be null, a non-empty string (e.g. "1:1"), or a positive number.');
}

registerOp(cropModule);
