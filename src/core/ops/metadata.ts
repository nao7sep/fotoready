import { registerOp } from "./registry";

registerOp({
  type: "strip-metadata",
  label: "Strip Metadata",
  category: "Metadata",
  defaultParams: { keep: ["author", "copyright", "orientation", "colorspace"] }
});

registerOp({
  type: "inject-metadata",
  label: "Inject Metadata",
  category: "Metadata",
  defaultParams: { fields: {} }
});
