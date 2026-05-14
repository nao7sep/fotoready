import { registerOp } from "./registry";

registerOp({
  type: "watermark-text",
  label: "Text Watermark",
  category: "Watermark",
  defaultParams: { text: "", anchor: "bottom-right", marginX: 0.02, marginY: 0.02, opacity: 0.7, font: "system", size: 0.03, color: "#ffffff" }
});

registerOp({
  type: "watermark-image",
  label: "Image Watermark",
  category: "Watermark",
  defaultParams: { pngPath: "", anchor: "bottom-right", marginX: 0.02, marginY: 0.02, opacity: 0.7, scale: 0.15 }
});
