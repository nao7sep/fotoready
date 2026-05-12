import { registerOp } from "./registry";

registerOp({
  type: "strip-metadata",
  label: "Strip Metadata",
  category: "Metadata",
  defaultParams: { keep: ["author", "copyright", "orientation", "colorspace"] },
  paramScaling: { keep: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "inject-metadata",
  label: "Inject Metadata",
  category: "Metadata",
  defaultParams: { fields: {} },
  paramScaling: { fields: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});
