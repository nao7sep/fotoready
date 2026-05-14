import { registerOp } from "./registry";

registerOp({
  type: "redact-fill",
  label: "Fill Redaction",
  category: "Redaction",
  defaultParams: { rects: [], color: "#000000" }
});

registerOp({
  type: "redact-blur",
  label: "Blur Redaction",
  category: "Redaction",
  defaultParams: { rects: [], radius: 20 }
});

registerOp({
  type: "redact-pixelate",
  label: "Pixelate Redaction",
  category: "Redaction",
  defaultParams: { rects: [], blockSize: 16 }
});
