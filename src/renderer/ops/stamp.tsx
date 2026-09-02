import React, { useState } from "react";
import { StampPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import type { OpCardProps } from "./op-renderer";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { fileNameFromPath } from "@shared/file-path";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";

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

export function StampSourceAction({ ctx, disabled, onParamsChange, params }: OpCardProps<AssetOverlayParams>): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadFailure, setReloadFailure] = useState<string | null>(null);

  async function openPicker(): Promise<void> {
    setReloadBusy(true);
    try {
      await ctx.reloadStamps?.();
      setReloadFailure(null);
      setPickerOpen(true);
    } catch (error) {
      setReloadFailure(presentFailure(
        error,
        "The stamp library could not be refreshed. The chooser remains closed; restore access to the stamp folder and try again.",
        "stamp library refresh before chooser failed",
        { opId: ctx.opId }
      ));
    } finally {
      setReloadBusy(false);
    }
  }

  return (
    <>
      <button className="toolbar-button compact-text" disabled={disabled || reloadBusy} type="button" onClick={() => void openPicker()}>
        Choose stamp...
      </button>
      {reloadFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel="Close stamp chooser result"
          severity="error"
          onDismiss={() => setReloadFailure(null)}
        >
          {reloadFailure}
        </OperationResult>
      ) : null}
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
  return fileNameFromPath(filePath);
}
