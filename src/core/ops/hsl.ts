import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertParamsShape, assertRecord, clamp01 } from "./_shared";

export const HSL_RANGES = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslRange = (typeof HSL_RANGES)[number];

type HslAdjustment = { hue: number; sat: number; lum: number };
type HslParams = Record<HslRange, HslAdjustment>;

const zeroAdjustment: HslAdjustment = { hue: 0, sat: 0, lum: 0 };

const hslModule: OpModule<HslParams> = {
  type: "hsl",
  label: "HSL",
  category: "Tone",
  previewBehavior: "show-output",
  defaultParams: Object.fromEntries(HSL_RANGES.map((range) => [range, { ...zeroAdjustment }])) as HslParams,
  validate(value) {
    const record = assertParamsShape(value, HSL_RANGES, "hsl.params");
    return Object.fromEntries(HSL_RANGES.map((range) => [range, validateRange(record[range], `hsl.params.${range}`)])) as HslParams;
  },
  async apply(image, params) {
    const { data: raw, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width <= 0 || info.height <= 0) return image;

    for (let offset = 0; offset < raw.length; offset += 4) {
      const hsl = rgbToHsl(raw[offset], raw[offset + 1], raw[offset + 2]);
      const adjustment = params[hueRangeName(hsl.h)];
      if (!adjustment || (adjustment.hue === 0 && adjustment.sat === 0 && adjustment.lum === 0)) continue;
      const rgb = hslToRgb(wrapHue(hsl.h + adjustment.hue), clamp01(hsl.s * (1 + adjustment.sat)), clamp01(hsl.l + adjustment.lum));
      raw[offset] = rgb.r;
      raw[offset + 1] = rgb.g;
      raw[offset + 2] = rgb.b;
    }

    const sharpImpl = (await import("sharp")).default;
    return sharpImpl(raw, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
};

function validateRange(value: unknown, path: string): HslAdjustment {
  const record = assertRecord(value, path);
  return {
    hue: assertFiniteNumber(record.hue, `${path}.hue`, { min: -180, max: 180 }),
    sat: assertFiniteNumber(record.sat, `${path}.sat`, { min: -1, max: 1 }),
    lum: assertFiniteNumber(record.lum, `${path}.lum`, { min: -1, max: 1 })
  };
}

function hueRangeName(hue: number): HslRange {
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 75) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "aqua";
  if (hue < 255) return "blue";
  if (hue < 285) return "purple";
  return "magenta";
}

function rgbToHsl(rByte: number, gByte: number, bByte: number): { h: number; s: number; l: number } {
  const r = rByte / 255;
  const g = gByte / 255;
  const b = bByte / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const h = max === r
    ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
    : max === g
      ? ((b - r) / delta + 2) * 60
      : ((r - g) / delta + 4) * 60;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h / 360 + 1 / 3);
  const g = hueToRgb(p, q, h / 360);
  const b = hueToRgb(p, q, h / 360 - 1 / 3);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function hueToRgb(p: number, q: number, tValue: number): number {
  let t = tValue;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

registerOp(hslModule);
