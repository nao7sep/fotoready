import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type UnsharpMaskParams = {
  radius: number;
  amount: number;
};

const unsharpMaskModule: OpModule<UnsharpMaskParams> = {
  type: "unsharp-mask",
  label: "Unsharp Mask",
  category: "Effects",
  previewBehavior: "show-output",
  defaultParams: { radius: 0.8, amount: 1.2 },
  validate(value) {
    const record = assertParamsShape(value, ["radius", "amount"], "unsharp-mask.params");
    return {
      radius: assertFiniteNumber(record.radius, "unsharp-mask.params.radius", { min: 0, minExclusive: true }),
      amount: assertFiniteNumber(record.amount, "unsharp-mask.params.amount", { min: 0 })
    };
  },
  apply(image, params) {
    if (params.amount <= 0) return image;
    return image.sharpen({
      sigma: Math.max(0.3, params.radius),
      m1: params.amount
    });
  }
};

registerOp(unsharpMaskModule);
