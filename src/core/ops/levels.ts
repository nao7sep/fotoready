import { CHANNEL_LIMITS, LEVELS_GAMMA_LIMITS, MIN_LEVEL_SPAN } from "@shared/op-limits";
import type { OpModule } from "./op-module";
import { applyPixels, assertFiniteNumber, assertParamsShape } from "./_shared";

type LevelsParams = {
  blackPoint: number;
  whitePoint: number;
  gamma: number;
};

export const levelsModule: OpModule<LevelsParams> = {
  type: "levels",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { blackPoint: CHANNEL_LIMITS.min, whitePoint: CHANNEL_LIMITS.max, gamma: 1 },
  validate(value) {
    const record = assertParamsShape(value, ["blackPoint", "whitePoint", "gamma"], "levels.params");
    const blackPoint = assertFiniteNumber(record.blackPoint, "levels.params.blackPoint", { integer: true, min: CHANNEL_LIMITS.min, max: CHANNEL_LIMITS.max - MIN_LEVEL_SPAN });
    const whitePoint = assertFiniteNumber(record.whitePoint, "levels.params.whitePoint", { integer: true, min: CHANNEL_LIMITS.min + MIN_LEVEL_SPAN, max: CHANNEL_LIMITS.max });
    if (whitePoint - blackPoint < MIN_LEVEL_SPAN) {
      throw new Error("levels.params.whitePoint must be greater than levels.params.blackPoint.");
    }
    return {
      blackPoint,
      whitePoint,
      gamma: assertFiniteNumber(record.gamma, "levels.params.gamma", LEVELS_GAMMA_LIMITS)
    };
  },
  transformPixels: transformLevels,
  apply: applyPixels(transformLevels)
};

function transformLevels(raw: Buffer, params: LevelsParams): void {
  const inputSpan = Math.max(1, params.whitePoint - params.blackPoint);
  for (let offset = 0; offset < raw.length; offset += 4) {
    raw[offset] = applyLevelsValue(raw[offset], params.blackPoint, inputSpan, params.gamma);
    raw[offset + 1] = applyLevelsValue(raw[offset + 1], params.blackPoint, inputSpan, params.gamma);
    raw[offset + 2] = applyLevelsValue(raw[offset + 2], params.blackPoint, inputSpan, params.gamma);
  }
}


function applyLevelsValue(value: number, blackPoint: number, inputSpan: number, gamma: number): number {
  const normalized = Math.max(0, Math.min(1, (value - blackPoint) / inputSpan));
  return Math.max(0, Math.min(255, Math.round(Math.pow(normalized, gamma) * 255)));
}
