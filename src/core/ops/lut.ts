import type { OpModule } from "./op-module";
import { sampleCubeLut } from "@runtime/lut/cube";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, assertString } from "./_shared";

type LutParams = {
  cubePath: string;
  strength: number;
};

const lutModule: OpModule<LutParams> = {
  type: "lut",
  label: "LUT",
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
  async apply(image, params, ctx) {
    if (!params.cubePath) return image;
    if (!ctx.resolveLut) {
      throw new Error("LUT loading is not configured for this pipeline run.");
    }

    const lut = await ctx.resolveLut(params.cubePath);
    const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width <= 0 || info.height <= 0) return image;

    for (let offset = 0; offset < raw.length; offset += 4) {
      const r = raw[offset] / 255;
      const g = raw[offset + 1] / 255;
      const b = raw[offset + 2] / 255;
      const sampled = sampleCubeLut(lut, r, g, b);
      raw[offset] = Math.max(0, Math.min(255, Math.round((r + (sampled[0] - r) * params.strength) * 255)));
      raw[offset + 1] = Math.max(0, Math.min(255, Math.round((g + (sampled[1] - g) * params.strength) * 255)));
      raw[offset + 2] = Math.max(0, Math.min(255, Math.round((b + (sampled[2] - b) * params.strength) * 255)));
    }

    const sharpImpl = (await import("sharp")).default;
    return sharpImpl(raw, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
};

registerOp(lutModule);
