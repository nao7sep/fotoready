import { registerOp } from "./registry";

registerOp({
  type: "unsharp-mask",
  label: "Unsharp Mask",
  category: "Effects",
  defaultParams: { radius: 1, amount: 1, threshold: 0, outputSharpen: false }
});

registerOp({
  type: "denoise",
  label: "Denoise",
  category: "Effects",
  defaultParams: { strength: 0.3 }
});

registerOp({
  type: "lut",
  label: "LUT",
  category: "Effects",
  defaultParams: { cubePath: "", strength: 1 }
});
