import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { applyAssetOverlay, validateAssetOverlayParams } from "./_asset-overlay";

const stampModule: OpModule<AssetOverlayParams> = {
  type: "stamp",
  label: "Stamp",
  category: "Conceal",
  previewBehavior: "show-output",
  defaultParams: {
    assetPath: "",
    x: 0.72,
    y: 0.78,
    opacity: 1,
    width: 0.18,
    rotation: 0
  },
  validate(value) {
    return validateAssetOverlayParams(value, "stamp.params");
  },
  async apply(image, params, ctx) {
    return applyAssetOverlay(image, params, ctx);
  }
};

registerOp(stampModule);
