import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";

export const watermarkImageRenderer = createAssetOverlayRenderer({
  type: "watermark-image",
  color: "#60a5fa",
  renderSourceField({ disabled, onParamChange, params }) {
    return (
      <input
        className="compact-control"
        disabled={disabled}
        placeholder="PNG or SVG file"
        type="text"
        value={params.assetPath}
        onChange={(event) => onParamChange("assetPath", event.currentTarget.value)}
      />
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
