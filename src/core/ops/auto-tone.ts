import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape } from "./_shared";
import { assertBoolean } from "@shared/validation/common";

type AutoToneParams = {
  enabled: boolean;
  strength: number;
};

const autoToneModule: OpModule<AutoToneParams> = {
  type: "auto-tone",
  label: "Auto Tone",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { enabled: true, strength: 0.7 },
  validate(value) {
    const record = assertParamsShape(value, ["enabled", "strength"], "auto-tone.params");
    return {
      enabled: assertBoolean(record.enabled, "auto-tone.params.enabled"),
      strength: assertFiniteNumber(record.strength, "auto-tone.params.strength", { min: 0, max: 1 })
    };
  },
  apply(image, params) {
    return params.enabled ? image.normalize() : image;
  }
};

registerOp(autoToneModule);
