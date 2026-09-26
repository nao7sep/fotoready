import React from "react";
import { ModalShell } from "./modal-shell";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { AlertRequest } from "./confirmer";

interface Props {
  request: AlertRequest;
  onClose(): void;
}

export function AlertModal({ request, onClose }: Props): React.JSX.Element {
  const { t } = useI18n();
  return (
    <ModalShell
      title={request.title}
      size="default"
      onClose={onClose}
      footer={
        <button className="primary-action" type="button" autoFocus onClick={onClose}>{t("common.ok")}</button>
      }
    >
      <div className="modal-message">{request.message}</div>
    </ModalShell>
  );
}
