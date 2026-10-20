import { DEFAULT_ASSET_OVERLAY_WIDTH, type AssetOverlayParams } from "@shared/asset-overlay";
import { createAssetOverlayModule } from "./_asset-overlay";

export const stampModule = createAssetOverlayModule({
  type: "stamp",
  category: "Conceal",
  defaultParams: {
    assetPath: "",
    x: 0.72,
    y: 0.78,
    width: DEFAULT_ASSET_OVERLAY_WIDTH,
    height: DEFAULT_ASSET_OVERLAY_WIDTH,
    lockAspectRatio: true,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 1,
    rotation: 0
  } satisfies AssetOverlayParams
});
