import type { AssetOverlayParams } from "@shared/asset-overlay";
import { registerOp } from "./registry";
import { createAssetOverlayModule } from "./_asset-overlay";

registerOp(createAssetOverlayModule({
  type: "watermark-image",
  label: "Image watermark",
  pickerLabel: "Image",
  category: "Watermark",
  defaultParams: {
    assetPath: "",
    x: 0.74,
    y: 0.82,
    opacity: 0.7,
    width: 0.15,
    rotation: 0
  } satisfies AssetOverlayParams
}));
