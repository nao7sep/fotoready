import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type AutoToneParams = {
  shadowClip: number;
  highlightClip: number;
};

const autoToneModule: OpModule<AutoToneParams> = {
  type: "auto-tone",
  label: "Auto Tone",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { shadowClip: 0, highlightClip: 0 },
  validate(value) {
    const record = assertParamsShape(value, ["shadowClip", "highlightClip"], "auto-tone.params");
    return {
      shadowClip: assertFiniteNumber(record.shadowClip, "auto-tone.params.shadowClip", { min: 0, max: 10 }),
      highlightClip: assertFiniteNumber(record.highlightClip, "auto-tone.params.highlightClip", { min: 0, max: 10 })
    };
  },
  apply(image, params) {
    if (params.shadowClip <= 0 && params.highlightClip <= 0) return image;
    return image.normalize({
      lower: params.shadowClip,
      upper: 100 - params.highlightClip
    });
  }
};

registerOp(autoToneModule);
