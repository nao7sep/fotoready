import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import { fileNameFromPath } from "@shared/file-path";

export const watermarkImageRenderer = createAssetOverlayRenderer({
  type: "watermark-image",
  color: "#60a5fa",
  flipControlsPlacement: "after-angle",
  renderSourceField({ params }) {
    return (
      <div className="asset-source-row asset-source-row-value-only">
        <span className="asset-source-value" title={params.assetPath}>{fileLabel(params.assetPath) ?? "No file selected"}</span>
      </div>
    );
  },
  renderSourceAction({ ctx, disabled, onParamsChange, params }) {
    return (
      <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={async () => {
        const picked = await api.system.pickFile({ title: "Choose watermark file", extensions: ["png", "svg"] });
        if (!picked) return;
        onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, picked));
      }}>
        Choose file
      </button>
    );
  }
});

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  return fileNameFromPath(filePath);
}
