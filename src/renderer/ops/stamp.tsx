import React, { useState } from "react";
import { StampPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import type { OpCardProps } from "./op-renderer";
import type { AssetOverlayParams } from "@shared/asset-overlay";

export const stampRenderer = createAssetOverlayRenderer({
  type: "stamp",
  color: "#38bdf8",
  flipControlsPlacement: "after-source",
  renderSourceField({ ctx, params }) {
    const selected = ctx.stamps.find((stamp) => stamp.path === params.assetPath) ?? null;
    return (
      <div className="asset-source-row asset-source-row-value-only">
        <span className="asset-source-value" title={selected?.path ?? params.assetPath}>{selected?.name ?? fileLabel(params.assetPath) ?? "No stamp selected"}</span>
      </div>
    );
  },
  renderSourceAction(props) {
    return <StampSourceAction {...props} />;
  }
});

function StampSourceAction({ ctx, disabled, onParamsChange, params }: OpCardProps<AssetOverlayParams>): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => {
        void ctx.reloadStamps?.();
        setPickerOpen(true);
      }}>
        Choose stamp...
      </button>
      {pickerOpen ? (
        <StampPickerModal
          previewLongEdge={ctx.assetPickerPreviewLongEdge}
          selectedPath={params.assetPath}
          stamps={ctx.stamps}
          onClose={() => setPickerOpen(false)}
          onReload={ctx.reloadStamps ?? (() => Promise.resolve())}
          onUse={async (path) => onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, path))}
        />
      ) : null}
    </>
  );
}

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  return fileName.replace(/\.[^.]+$/, "");
}
