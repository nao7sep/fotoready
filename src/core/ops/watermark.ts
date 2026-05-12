import { registerOp } from "./registry";

registerOp({
  type: "watermark-text",
  label: "Text Watermark",
  category: "Watermark",
  defaultParams: { text: "", anchor: "bottom-right", marginX: 0.02, marginY: 0.02, opacity: 0.7, font: "system", size: 0.03, color: "#ffffff" },
  paramScaling: { text: "scale_invariant", anchor: "fraction_of_long_edge", marginX: "fraction_of_long_edge", marginY: "fraction_of_long_edge", opacity: "scale_invariant", font: "scale_invariant", size: "fraction_of_long_edge", color: "scale_invariant" },
  schema: { type: "object", properties: {}, additionalProperties: true },
  visible: true
});

registerOp({
  type: "watermark-image",
  label: "Image Watermark",
  category: "Watermark",
  defaultParams: { pngPath: "", anchor: "bottom-right", marginX: 0.02, marginY: 0.02, opacity: 0.7, scale: 0.15 },
  paramScaling: { pngPath: "scale_invariant", anchor: "fraction_of_long_edge", marginX: "fraction_of_long_edge", marginY: "fraction_of_long_edge", opacity: "scale_invariant", scale: "fraction_of_long_edge" },
  schema: { type: "object", properties: {}, required: ["pngPath"], additionalProperties: true },
  visible: true
});
