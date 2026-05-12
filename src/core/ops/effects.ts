import { registerOp } from "./registry";

registerOp({
  type: "unsharp-mask",
  label: "Unsharp Mask",
  category: "Effects",
  defaultParams: { radius: 1, amount: 1, threshold: 0, outputSharpen: false },
  paramScaling: { radius: "fraction_of_long_edge", amount: "scale_invariant", threshold: "scale_invariant", outputSharpen: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "denoise",
  label: "Denoise",
  category: "Effects",
  defaultParams: { strength: 0.3 },
  paramScaling: { strength: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "lut",
  label: "LUT",
  category: "Effects",
  defaultParams: { cubePath: "", strength: 1 },
  paramScaling: { cubePath: "scale_invariant", strength: "scale_invariant" },
  schema: { type: "object", properties: {}, required: ["cubePath"], additionalProperties: true },
  visible: true
});
