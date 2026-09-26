import { useI18n } from "@renderer/i18n/I18nContext";
import React, { useState } from "react";
import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import { fileNameFromPath } from "@shared/file-path";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCardContext } from "./op-renderer";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { message, type Message } from "@shared/i18n/translate";

export const watermarkImageRenderer = createAssetOverlayRenderer({
  type: "watermark-image",
  color: "#60a5fa",
  flipControlsPlacement: "after-angle",
  renderSourceField({ params }) {
    return <WatermarkSourceField assetPath={params.assetPath} />;
  },
  renderSourceAction({ ctx, disabled, onParamsChange, params }) {
    return <WatermarkSourceAction ctx={ctx} disabled={disabled} onParamsChange={onParamsChange} params={params} />;
  }
});

function WatermarkSourceField({ assetPath }: { assetPath: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="asset-source-row asset-source-row-value-only">
      <span className="asset-source-value" title={assetPath}>{fileLabel(assetPath) ?? t("watermarkImage.noneSelected")}</span>
    </div>
  );
}

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
  const { t, text } = useI18n();
  const [failure, setFailure] = useState<Message | null>(null);

  async function choose(): Promise<void> {
    try {
      const picked = await api.system.pickFile({ title: t("watermarkImage.chooseTitle"), extensions: ["png", "svg"] });
      if (!picked) return;
      onParamsChange(await normalizeAssetOverlayForPath(params, ctx.originalSize, picked));
      setFailure(null);
    } catch (error) {
      setFailure(presentFailure(error, message("failure.watermarkPick"), "watermark file picker failed"));
    }
  }

  return (
    <div className="asset-source-action-stack">
      <button className="toolbar-button compact-text" disabled={disabled} type="button" onClick={() => void choose()}>
        {t("watermarkImage.choose")}
      </button>
      {failure ? (
        <OperationResult
          className="modal-error"
          dismissLabel={t("watermarkImage.closeResult")}
          severity="error"
          onDismiss={() => setFailure(null)}
        >
          {text(failure)}
        </OperationResult>
      ) : null}
    </div>
  );
}

function fileLabel(filePath: string): string | null {
  if (!filePath) return null;
  return fileNameFromPath(filePath);
}
