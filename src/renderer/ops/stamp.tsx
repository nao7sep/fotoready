import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";

export const stampRenderer = createAssetOverlayRenderer({
  type: "stamp",
  color: "#38bdf8",
  renderSourceField({ ctx, disabled, onParamsChange, params }) {
    return (
      <select
        className="compact-control"
        disabled={disabled}
        value={params.assetPath}
        onFocus={() => void ctx.reloadStamps?.()}
        onPointerDown={() => void ctx.reloadStamps?.()}
        onChange={async (event) => {
          onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, event.currentTarget.value));
        }}
      >
        <option value="">Choose a stamp</option>
        {ctx.stamps.map((stamp) => <option key={stamp.path} value={stamp.path}>{stamp.name}</option>)}
      </select>
    );
  },
  renderSourceAction({ ctx, disabled, onParamsChange, params }) {
    return (
      <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={async () => {
        const picked = await api.system.pickFile({ title: "Import Stamp", extensions: ["png", "svg"] });
        if (!picked) return;
        const imported = await api.stamps.import(picked);
        await ctx.reloadStamps?.();
        onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, imported.path));
      }}>
        Import Stamp...
      </button>
    );
  }
});
