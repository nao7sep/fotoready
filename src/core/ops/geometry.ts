import { registerOp } from "./registry";

registerOp({
  type: "crop",
  label: "Crop",
  category: "Geometry",
  defaultParams: { x: 0, y: 0, w: 1, h: 1, aspectLock: null },
  paramScaling: { x: "fraction_of_long_edge", y: "fraction_of_long_edge", w: "fraction_of_long_edge", h: "fraction_of_long_edge", aspectLock: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "rotate",
  label: "Rotate",
  category: "Geometry",
  defaultParams: { degrees: 0, fillColor: "#ffffff" },
  paramScaling: { degrees: "scale_invariant", fillColor: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "resize",
  label: "Resize",
  category: "Geometry",
  defaultParams: { mode: "long-edge", value: 1920, interpolation: "lanczos3" },
  paramScaling: { mode: "scale_invariant", value: "absolute_px", interpolation: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});
