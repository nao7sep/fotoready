import { useState } from "react";
import { api } from "@renderer/ipc/client";
import { OperationResult } from "@renderer/components/operation-result";
import { presentFailure } from "@renderer/present-failure";
import { useI18n } from "@renderer/i18n/I18nContext";
import { message, type Message } from "@shared/i18n/translate";

/**
 * The chosen asset's name in an op card. It identifies the asset, so it takes one line and ends in
 * an ellipsis when long; the name is a button that shows the file in Finder or Explorer, so its
 * complete name and location are a click or a keypress away (interface-styling-conventions, Labels).
 */
export function AssetSourceValue({ path, label, emptyLabel }: { path: string; label: string | null; emptyLabel: string }): React.JSX.Element {
  const { text } = useI18n();
  const [failure, setFailure] = useState<Message | null>(null);

  async function reveal(): Promise<void> {
    try {
      await api.system.revealInFolder(path);
      setFailure(null);
    } catch (error) {
      setFailure(presentFailure(error, message("failure.fileReveal"), "asset reveal failed", { path }));
    }
  }

  return (
    <>
      <div className="asset-source-row asset-source-row-value-only">
        {label && path ? (
          <button className="asset-source-value" type="button" title={path} onClick={() => void reveal()}>{label}</button>
        ) : (
          <span className="asset-source-value empty">{label ?? emptyLabel}</span>
        )}
      </div>
      {failure ? (
        <OperationResult className="modal-error" severity="error" onDismiss={() => setFailure(null)}>
          {text(failure)}
        </OperationResult>
      ) : null}
    </>
  );
}
