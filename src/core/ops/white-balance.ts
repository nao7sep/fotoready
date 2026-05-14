import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, clamp, validateOptionalSamplePoint } from "./_shared";

type WhiteBalanceParams = {
  temperature: number;
  tint: number;
  samplePoint: [number, number] | null;
};

const whiteBalanceModule: OpModule<WhiteBalanceParams> = {
  type: "white-balance",
  label: "White Balance",
  category: "Tone",
  previewBehavior: "show-input",
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
    if (params.samplePoint) {
      const metadata = await image.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width > 0 && height > 0) {
        const longEdge = Math.max(width, height);
        const sampleX = Math.max(0, Math.min(width - 1, Math.round(params.samplePoint[0] * longEdge)));
        const sampleY = Math.max(0, Math.min(height - 1, Math.round(params.samplePoint[1] * longEdge)));
        const raw = await image.clone().ensureAlpha().raw().toBuffer();
        const offset = (sampleY * width + sampleX) * 4;
        const r = raw[offset] ?? 0;
        const g = raw[offset + 1] ?? 0;
        const b = raw[offset + 2] ?? 0;
        const target = Math.max(1, (r + g + b) / 3);
        return image.linear(
          [clamp(target / Math.max(1, r), 0.2, 4), clamp(target / Math.max(1, g), 0.2, 4), clamp(target / Math.max(1, b), 0.2, 4)],
          [0, 0, 0]
        );
      }
    }

    const red = 1 + params.temperature / 500;
    const blue = 1 - params.temperature / 500;
    const green = 1 + params.tint / 700;
    return image.linear([red, green, blue], [0, 0, 0]);
  }
};

registerOp(whiteBalanceModule);
