import { registerOp } from "./registry";

registerOp({
  type: "redact-fill",
  label: "Fill Redaction",
  category: "Redaction",
  defaultParams: { rects: [], color: "#000000" },
  paramScaling: { rects: "fraction_of_long_edge", color: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "redact-blur",
  label: "Blur Redaction",
  category: "Redaction",
  defaultParams: { rects: [], radius: 20 },
  paramScaling: { rects: "fraction_of_long_edge", radius: "fraction_of_long_edge" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "redact-pixelate",
  label: "Pixelate Redaction",
  category: "Redaction",
  defaultParams: { rects: [], blockSize: 16 },
  paramScaling: { rects: "fraction_of_long_edge", blockSize: "fraction_of_long_edge" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});
