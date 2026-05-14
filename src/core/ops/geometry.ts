import { registerOp } from "./registry";

registerOp({
  type: "crop",
  label: "Crop",
  category: "Geometry",
  defaultParams: { x: 0, y: 0, w: 1, h: 1, aspectLock: null }
});

registerOp({
  type: "rotate",
  label: "Rotate",
  category: "Geometry",
  defaultParams: { degrees: 0, fillColor: "#ffffff" }
});

registerOp({
  type: "resize",
  label: "Resize",
  category: "Geometry",
  defaultParams: { mode: "long-edge", value: 1920, interpolation: "lanczos3" }
});
