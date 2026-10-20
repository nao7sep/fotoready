import { MIN_BLUR_SIGMA } from "@shared/op-limits";
import type { OpModule } from "./op-module";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type UnsharpMaskParams = {
  radius: number;
  amount: number;
};

export const unsharpMaskModule: OpModule<UnsharpMaskParams> = {
  type: "unsharp-mask",
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
      sigma: Math.max(MIN_BLUR_SIGMA, params.radius),
      m1: params.amount
    });
  }
};
