import { AUTO_TONE_CLIP_LIMITS } from "@shared/op-limits";
import type { OpModule } from "./op-module";
import { assertFiniteNumber, assertParamsShape } from "./_shared";

type AutoToneParams = {
  shadowClip: number;
  highlightClip: number;
};

export const autoToneModule: OpModule<AutoToneParams> = {
  type: "auto-tone",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { shadowClip: 0, highlightClip: 0 },
  validate(value) {
    const record = assertParamsShape(value, ["shadowClip", "highlightClip"], "auto-tone.params");
    return {
      shadowClip: assertFiniteNumber(record.shadowClip, "auto-tone.params.shadowClip", AUTO_TONE_CLIP_LIMITS),
      highlightClip: assertFiniteNumber(record.highlightClip, "auto-tone.params.highlightClip", AUTO_TONE_CLIP_LIMITS)
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
