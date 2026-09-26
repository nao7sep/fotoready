import { useI18n } from "@renderer/i18n/I18nContext";
import React, { useState } from "react";
import { StampPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "./_asset-overlay";
import type { OpCardProps } from "./op-renderer";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { fileNameFromPath } from "@shared/file-path";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { message, type Message } from "@shared/i18n/translate";

export const stampRenderer = createAssetOverlayRenderer({
  type: "stamp",
  color: "#38bdf8",
  flipControlsPlacement: "after-source",
  renderSourceField({ ctx, params }) {
    return <StampSourceField ctx={ctx} params={params} />;
  },
  renderSourceAction(props) {
    return <StampSourceAction {...props} />;
  }
});

function StampSourceField({ ctx, params }: Pick<OpCardProps<AssetOverlayParams>, "ctx" | "params">): React.JSX.Element {
    const { t } = useI18n();
    const selected = ctx.stamps.find((stamp) => stamp.path === params.assetPath) ?? null;
    return (
      <div className="asset-source-row asset-source-row-value-only">
        <span className="asset-source-value" title={selected?.path ?? params.assetPath}>{selected?.name ?? fileLabel(params.assetPath) ?? t("stamp.noneSelected")}</span>
      </div>
    );
}

export function StampSourceAction({ ctx, disabled, onParamsChange, params }: OpCardProps<AssetOverlayParams>): React.JSX.Element {
  const { t, text } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadFailure, setReloadFailure] = useState<Message | null>(null);

  async function openPicker(): Promise<void> {
    setReloadBusy(true);
    try {
      await ctx.reloadStamps?.();
      setReloadFailure(null);
      setPickerOpen(true);
    } catch (error) {
      setReloadFailure(presentFailure(error, message("failure.stampRefresh"), "stamp library refresh before chooser failed", { opId: ctx.opId }));
    } finally {
      setReloadBusy(false);
    }
  }

  return (
    <>
      <button className="toolbar-button compact-text" disabled={disabled || reloadBusy} type="button" onClick={() => void openPicker()}>
        {t("stamp.choose")}
      </button>
      {reloadFailure ? (
        <OperationResult
          className="modal-error"
          dismissLabel={t("stamp.closeResult")}
          severity="error"
          onDismiss={() => setReloadFailure(null)}
        >
          {text(reloadFailure)}
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
