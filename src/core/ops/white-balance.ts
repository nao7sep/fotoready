import type { OpModule } from "./op-module";
import { applyPixels, assertFiniteNumber, assertParamsShape, validateOptionalSamplePoint } from "./_shared";

type WhiteBalanceParams = {
  temperature: number;
  tint: number;
  samplePoint: [number, number] | null;
};

export const whiteBalanceModule: OpModule<WhiteBalanceParams> = {
  type: "white-balance",
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
  // A per-channel gain, applied in the shared per-pixel pass rather than as its own full-frame render.
  transformPixels: transformWhiteBalance,
  apply: applyPixels(transformWhiteBalance)
};

function transformWhiteBalance(raw: Buffer, params: WhiteBalanceParams): void {
  const gains = [1 + params.temperature / 500, 1 + params.tint / 700, 1 - params.temperature / 500];
  for (let offset = 0; offset < raw.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      // Truncated, as the image library's own linear step rounded it, so saved pixels are unchanged.
      raw[offset + channel] = Math.min(255, Math.floor(raw[offset + channel] * gains[channel]!));
    }
  }
}
