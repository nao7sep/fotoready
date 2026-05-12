import { registerOp } from "./registry";

registerOp({
  type: "levels",
  label: "Levels",
  category: "Tone",
  defaultParams: { blackPoint: 0, whitePoint: 255, gamma: 1 },
  paramScaling: { blackPoint: "scale_invariant", whitePoint: "scale_invariant", gamma: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "white-balance",
  label: "White Balance",
  category: "Tone",
  defaultParams: { temperature: 0, tint: 0 },
  paramScaling: { temperature: "scale_invariant", tint: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "auto-tone",
  label: "Auto Tone",
  category: "Tone",
  defaultParams: { enabled: true, strength: 0.7 },
  paramScaling: { enabled: "scale_invariant", strength: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "curves",
  label: "Curves",
  category: "Tone",
  defaultParams: { rgb: [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]] },
  paramScaling: { rgb: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "hsl",
  label: "HSL",
  category: "Tone",
  defaultParams: {
    red: { hue: 0, sat: 0, lum: 0 },
    orange: { hue: 0, sat: 0, lum: 0 },
    yellow: { hue: 0, sat: 0, lum: 0 },
    green: { hue: 0, sat: 0, lum: 0 },
    aqua: { hue: 0, sat: 0, lum: 0 },
    blue: { hue: 0, sat: 0, lum: 0 },
    purple: { hue: 0, sat: 0, lum: 0 },
    magenta: { hue: 0, sat: 0, lum: 0 }
  },
  paramScaling: {
    red: "scale_invariant",
    orange: "scale_invariant",
    yellow: "scale_invariant",
    green: "scale_invariant",
    aqua: "scale_invariant",
    blue: "scale_invariant",
    purple: "scale_invariant",
    magenta: "scale_invariant"
  },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});
