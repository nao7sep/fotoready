import type { AssetOverlayParams } from "@shared/asset-overlay";
import { registerOp } from "./registry";
import { createAssetOverlayModule } from "./_asset-overlay";

registerOp(createAssetOverlayModule({
  type: "stamp",
  label: "Stamp",
  category: "Conceal",
  defaultParams: {
    assetPath: "",
    x: 0.72,
    y: 0.78,
    opacity: 1,
    width: 0.18,
    rotation: 0
  } satisfies AssetOverlayParams
}));
