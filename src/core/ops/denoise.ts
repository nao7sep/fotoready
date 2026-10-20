import type { OpModule } from "./op-module";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type DenoiseParams = {
  strength: number;
};

export const denoiseModule: OpModule<DenoiseParams> = {
  type: "denoise",
  category: "Effects",
  previewBehavior: "show-output",
  defaultParams: { strength: 0.3 },
  validate(value) {
    const record = assertParamsShape(value, ["strength"], "denoise.params");
    return {
      strength: assertFiniteNumber(record.strength, "denoise.params.strength", { min: 0, max: 1 })
    };
  },
  apply(image, params) {
    if (params.strength <= 0) return image;
    return image.median(Math.max(1, Math.round(params.strength * 7)));
  }
};
