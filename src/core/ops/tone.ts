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
