import React from "react";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { api } from "@renderer/ipc/client";
import type { OpRenderer } from "./op-renderer";
import { AssetOverlayControls, AssetOverlayRect, normalizeAssetOverlayForPath, useLocalAssetAspectRatio } from "./_asset-overlay";

export const stampRenderer: OpRenderer<AssetOverlayParams> = {
  type: "stamp",
  Card({ params, disabled, ctx, onParamChange, onParamsChange }) {
    const aspectRatio = useLocalAssetAspectRatio(params.assetPath);
    return (
      <AssetOverlayControls
        aspectRatio={aspectRatio}
        ctx={ctx}
        disabled={disabled}
        params={params}
        onParamChange={onParamChange}
        onParamsChange={onParamsChange}
        sourceControl={(
          <div className="watermark-file-row">
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
            <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={async () => {
              const picked = await api.system.pickFile({ title: "Import Stamp", extensions: ["png", "svg"] });
              if (!picked) return;
              const imported = await api.stamps.import(picked);
              await ctx.reloadStamps?.();
              onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, imported.path));
            }}>
              Import Stamp...
            </button>
          </div>
        )}
      />
    );
  },
  Overlay({ params, selected, ctx, onParamsChange }) {
    const aspectRatio = useLocalAssetAspectRatio(params.assetPath);
    return <AssetOverlayRect aspectRatio={aspectRatio} color="#38bdf8" ctx={ctx} onParamsChange={onParamsChange} params={params} selected={selected} />;
  }
};
