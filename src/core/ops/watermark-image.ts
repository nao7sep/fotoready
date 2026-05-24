import { DEFAULT_ASSET_OVERLAY_WIDTH, type AssetOverlayParams } from "@shared/asset-overlay";
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
    width: DEFAULT_ASSET_OVERLAY_WIDTH,
    height: DEFAULT_ASSET_OVERLAY_WIDTH,
    lockAspectRatio: true,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 0.7,
    rotation: 0
  } satisfies AssetOverlayParams
}));
