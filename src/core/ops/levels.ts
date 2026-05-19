import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type LevelsParams = {
  blackPoint: number;
  whitePoint: number;
  gamma: number;
};

const levelsModule: OpModule<LevelsParams> = {
  type: "levels",
  label: "Levels",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { blackPoint: 0, whitePoint: 255, gamma: 1 },
  validate(value) {
    const record = assertParamsShape(value, ["blackPoint", "whitePoint", "gamma"], "levels.params");
    const blackPoint = assertFiniteNumber(record.blackPoint, "levels.params.blackPoint", { integer: true, min: 0, max: 254 });
    const whitePoint = assertFiniteNumber(record.whitePoint, "levels.params.whitePoint", { integer: true, min: 1, max: 255 });
    if (whitePoint <= blackPoint) {
      throw new Error("levels.params.whitePoint must be greater than levels.params.blackPoint.");
    }
    return {
      blackPoint,
      whitePoint,
      gamma: assertFiniteNumber(record.gamma, "levels.params.gamma", { min: 0.25, max: 4 })
    };
  },
  async apply(image, params) {
    const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width <= 0 || info.height <= 0) return image;

    const inputSpan = Math.max(1, params.whitePoint - params.blackPoint);
    for (let offset = 0; offset < raw.length; offset += 4) {
      raw[offset] = applyLevelsValue(raw[offset], params.blackPoint, inputSpan, params.gamma);
      raw[offset + 1] = applyLevelsValue(raw[offset + 1], params.blackPoint, inputSpan, params.gamma);
      raw[offset + 2] = applyLevelsValue(raw[offset + 2], params.blackPoint, inputSpan, params.gamma);
    }

    const sharpImpl = (await import("sharp")).default;
    return sharpImpl(raw, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
};

registerOp(levelsModule);

function applyLevelsValue(value: number, blackPoint: number, inputSpan: number, gamma: number): number {
  const normalized = Math.max(0, Math.min(1, (value - blackPoint) / inputSpan));
  return Math.max(0, Math.min(255, Math.round(Math.pow(normalized, gamma) * 255)));
}
