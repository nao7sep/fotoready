import React from "react";
import { ModalShell } from "./modal-shell";
import type { ConfirmRequest } from "./confirmer";

interface Props {
  request: ConfirmRequest;
  onClose(answer: boolean): void;
}

export function ConfirmModal({ request, onClose }: Props): React.JSX.Element {
  return (
    <ModalShell
      title={request.title}
      size="default"
      onClose={() => onClose(false)}
      footer={
        <>
          <button className="toolbar-button" type="button" onClick={() => onClose(false)}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={request.danger ? "primary-action danger" : "primary-action"}
            type="button"
            autoFocus
            onClick={() => onClose(true)}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </>
      }
    >
      <div className="modal-message">{request.message}</div>
    </ModalShell>
  );
}
