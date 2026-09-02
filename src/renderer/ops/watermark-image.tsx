import React, { useState } from "react";
import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import { fileNameFromPath } from "@shared/file-path";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCardContext } from "./op-renderer";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";

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
    return <WatermarkSourceAction ctx={ctx} disabled={disabled} onParamsChange={onParamsChange} params={params} />;
  }
});

export function WatermarkSourceAction({
  ctx,
  disabled,
  onParamsChange,
  params
}: {
  ctx: OpCardContext;
  disabled: boolean;
  onParamsChange(patch: Partial<AssetOverlayParams>): void;
  params: AssetOverlayParams;
}): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);

  async function choose(): Promise<void> {
    try {
      const picked = await api.system.pickFile({ title: "Choose watermark file", extensions: ["png", "svg"] });
      if (!picked) return;
      onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, picked));
      setFailure(null);
    } catch (error) {
      setFailure(presentFailure(
        error,
        "The watermark file could not be chosen. The current watermark is unchanged; try again.",
        "watermark file picker failed"
      ));
    }
  }

  return (
    <div className="asset-source-action-stack">
      <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => void choose()}>
        Choose file
      </button>
      {failure ? (
        <OperationResult
          className="modal-error"
          dismissLabel="Close watermark result"
          severity="error"
          onDismiss={() => setFailure(null)}
        >
          {failure}
        </OperationResult>
      ) : null}
    </div>
  );
}

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  return fileNameFromPath(filePath);
}
