import type { OpModule } from "./op-module";
import { sampleCubeLut } from "@runtime/lut-cube";
import { applyPixels, assertFiniteNumber, assertParamsShape, assertString } from "./_shared";
import type { OpApplyContext } from "./op-module";

type LutParams = {
  cubePath: string;
  strength: number;
};

export const lutModule: OpModule<LutParams> = {
  type: "lut",
  category: "Effects",
  previewBehavior: "show-output",
  defaultParams: { cubePath: "", strength: 1 },
  validate(value) {
    const record = assertParamsShape(value, ["cubePath", "strength"], "lut.params");
    return {
      cubePath: assertString(record.cubePath, "lut.params.cubePath"),
      strength: assertFiniteNumber(record.strength, "lut.params.strength", { min: 0, max: 1 })
    };
  },
  transformPixels: transformLut,
  async apply(image, params, ctx) {
    if (!params.cubePath || params.strength <= 0) return image;
    return applyPixels(transformLut)(image, params, ctx);
  }
};

async function transformLut(raw: Buffer, params: LutParams, ctx: OpApplyContext): Promise<void> {
  if (!params.cubePath || params.strength <= 0) return;
  if (!ctx.resolveLut) {
    throw new Error("LUT loading is not configured for this pipeline run.");
  }
  const lut = await ctx.resolveLut(params.cubePath);
  for (let offset = 0; offset < raw.length; offset += 4) {
    const r = raw[offset] / 255;
    const g = raw[offset + 1] / 255;
    const b = raw[offset + 2] / 255;
    const sampled = sampleCubeLut(lut, r, g, b);
    raw[offset] = Math.max(0, Math.min(255, Math.round((r + (sampled[0] - r) * params.strength) * 255)));
    raw[offset + 1] = Math.max(0, Math.min(255, Math.round((g + (sampled[1] - g) * params.strength) * 255)));
    raw[offset + 2] = Math.max(0, Math.min(255, Math.round((b + (sampled[2] - b) * params.strength) * 255)));
  }
}
