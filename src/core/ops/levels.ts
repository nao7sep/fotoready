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
      gamma: assertFiniteNumber(record.gamma, "levels.params.gamma", { min: 0.1, max: 5 })
    };
  },
  apply(image, params) {
    const multiplier = 255 / (params.whitePoint - params.blackPoint);
    const offset = -params.blackPoint * multiplier;
    return image.linear(multiplier, offset).gamma(params.gamma);
  }
};

registerOp(levelsModule);
