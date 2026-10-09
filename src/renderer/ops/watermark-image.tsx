import { useI18n } from "@renderer/i18n/I18nContext";
import React, { useEffect, useRef, useState } from "react";
import { api } from "@renderer/ipc/client";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import { fileNameFromPath } from "@shared/file-path";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import type { OpCardContext } from "./op-renderer";
import type { TaskEditOptions } from "@shared/types/ipc";
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
  onParamsChange(patch: Partial<AssetOverlayParams>, options?: TaskEditOptions): void | Promise<void>;
  params: AssetOverlayParams;
}): React.JSX.Element {
  const { t, text } = useI18n();
  const [failure, setFailure] = useState<Message | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = useRef({ ctx, params });
  current.current = { ctx, params };

  async function choose(): Promise<void> {
    try {
      const picked = await api.system.pickFile({ title: t("watermarkImage.chooseTitle"), extensions: ["png", "svg", "webp"] });
      if (!picked) return;
      // As the stamp picker does: the patch applies only to the task and values it was made from, and the
      // session refuses it if they changed meanwhile, so a task switch or an edit during the wait is kept.
      const started = current.current;
      const expectedParams = structuredClone(started.params);
      const patch = await normalizeAssetOverlayForPath(expectedParams, started.ctx.originalSize, picked);
      if (!alive.current || current.current.ctx.activeTaskId !== started.ctx.activeTaskId ||
          JSON.stringify(current.current.ctx.originalSize) !== JSON.stringify(started.ctx.originalSize) ||
          JSON.stringify(current.current.params) !== JSON.stringify(expectedParams)) {
        throw new Error("The task changed while the image was being selected. Choose it again.");
      }
      await onParamsChange(patch, { expectedParams });
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
