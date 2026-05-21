import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, materialize, validateOptionalSamplePoint } from "./_shared";

type WhiteBalanceParams = {
  temperature: number;
  tint: number;
  samplePoint: [number, number] | null;
};

const whiteBalanceModule: OpModule<WhiteBalanceParams> = {
  type: "white-balance",
  label: "White Balance",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { temperature: 0, tint: 0, samplePoint: null },
  validate(value) {
    const record = assertParamsShape(value, ["temperature", "tint", "samplePoint"], "white-balance.params");
    return {
      temperature: assertFiniteNumber(record.temperature, "white-balance.params.temperature", { min: -100, max: 100 }),
      tint: assertFiniteNumber(record.tint, "white-balance.params.tint", { min: -100, max: 100 }),
      samplePoint: validateOptionalSamplePoint(record.samplePoint, "white-balance.params.samplePoint")
    };
  },
  async apply(image, params) {
    const red = 1 + params.temperature / 500;
    const blue = 1 - params.temperature / 500;
    const green = 1 + params.tint / 700;
    return materialize(image.linear([red, green, blue], [0, 0, 0]));
  }
};

registerOp(whiteBalanceModule);
