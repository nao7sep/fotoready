import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape } from "./_shared";
import { assertBoolean } from "@shared/validation/common";

type UnsharpMaskParams = {
  radius: number;
  amount: number;
  threshold: number;
  outputSharpen: boolean;
};

const unsharpMaskModule: OpModule<UnsharpMaskParams> = {
  type: "unsharp-mask",
  label: "Unsharp Mask",
  category: "Effects",
  previewBehavior: "show-output",
  defaultParams: { radius: 1, amount: 1, threshold: 0, outputSharpen: false },
  validate(value) {
    const record = assertParamsShape(value, ["radius", "amount", "threshold", "outputSharpen"], "unsharp-mask.params");
    return {
      radius: assertFiniteNumber(record.radius, "unsharp-mask.params.radius", { min: 0, minExclusive: true }),
      amount: assertFiniteNumber(record.amount, "unsharp-mask.params.amount", { min: 0 }),
      threshold: assertFiniteNumber(record.threshold, "unsharp-mask.params.threshold", { min: 0 }),
      outputSharpen: assertBoolean(record.outputSharpen, "unsharp-mask.params.outputSharpen")
    };
  },
  apply(image, params) {
    return image.sharpen({
      sigma: Math.max(0.3, params.radius),
      m1: params.amount
    });
  }
};

registerOp(unsharpMaskModule);
