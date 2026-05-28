import React from "react";
import { ModalShell } from "./modal-shell";
import type { AlertRequest } from "./confirmer";

interface Props {
  request: AlertRequest;
  onClose(): void;
}

export function AlertModal({ request, onClose }: Props): React.JSX.Element {
  return (
    <ModalShell
      title={request.title}
      size="default"
      onClose={onClose}
      footer={
        <button className="primary-action" type="button" autoFocus onClick={onClose}>OK</button>
      }
    >
      <div className="modal-message">{request.message}</div>
    </ModalShell>
  );
}
