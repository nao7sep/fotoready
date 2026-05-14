import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertArray, assertFiniteNumber, assertParamsShape } from "./_shared";

type CurvesParams = {
  rgb: Array<[number, number]>;
};

const curvesModule: OpModule<CurvesParams> = {
  type: "curves",
  label: "Curves",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: { rgb: [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]] },
  validate(value) {
    const record = assertParamsShape(value, ["rgb"], "curves.params");
    const points = assertArray(record.rgb, "curves.params.rgb").map((point, index) => {
      const tuple = assertArray(point, `curves.params.rgb[${index}]`);
      if (tuple.length < 2) {
        throw new Error(`curves.params.rgb[${index}] must contain two numeric values.`);
      }
      return [
        assertFiniteNumber(tuple[0], `curves.params.rgb[${index}][0]`, { min: 0, max: 255 }),
        assertFiniteNumber(tuple[1], `curves.params.rgb[${index}][1]`, { min: 0, max: 255 })
      ] as [number, number];
    });
    if (points.length < 2) {
      throw new Error("curves.params.rgb must contain at least two control points.");
    }
    return { rgb: points };
  },
  async apply(image, params) {
    const lut = curveLookup(params.rgb);
    const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width <= 0 || info.height <= 0) return image;

    for (let offset = 0; offset < raw.length; offset += 4) {
      raw[offset] = lut[raw[offset]];
      raw[offset + 1] = lut[raw[offset + 1]];
      raw[offset + 2] = lut[raw[offset + 2]];
    }

    const sharpImpl = (await import("sharp")).default;
    return sharpImpl(raw, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
};

function curveLookup(points: Array<[number, number]>): Uint8Array {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const upperIndex = sorted.findIndex(([x]) => x >= value);
    if (upperIndex === -1) {
      lut[value] = Math.round(sorted[sorted.length - 1][1]);
      continue;
    }
    if (upperIndex <= 0) {
      lut[value] = Math.round(sorted[0][1]);
      continue;
    }
    const lower = sorted[upperIndex - 1];
    const upper = sorted[upperIndex];
    const span = Math.max(1, upper[0] - lower[0]);
    const t = (value - lower[0]) / span;
    lut[value] = Math.round(lower[1] + (upper[1] - lower[1]) * t);
  }
  return lut;
}

registerOp(curvesModule);
