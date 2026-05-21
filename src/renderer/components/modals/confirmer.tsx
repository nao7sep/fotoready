import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ModalShell } from "./modal-shell";

export type ConfirmRequest = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type AlertRequest = {
  title: string;
  message: React.ReactNode;
};

type ConfirmerApi = {
  confirm(request: ConfirmRequest): Promise<boolean>;
  alert(request: AlertRequest): Promise<void>;
};

const Context = createContext<ConfirmerApi | null>(null);

export function useConfirmer(): ConfirmerApi {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useConfirmer must be called inside <ConfirmerProvider>.");
  }
  return value;
}

type ConfirmState = { request: ConfirmRequest; resolve(answer: boolean): void };
type AlertState = { request: AlertRequest; resolve(): void };

export function ConfirmerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [alertState, setAlertState] = useState<AlertState | null>(null);

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ request, resolve });
    });
  }, []);

  const alert = useCallback((request: AlertRequest) => {
    return new Promise<void>((resolve) => {
      setAlertState({ request, resolve });
    });
  }, []);

  const api = useMemo<ConfirmerApi>(() => ({ confirm, alert }), [confirm, alert]);

  function closeConfirm(answer: boolean): void {
    if (!confirmState) return;
    const { resolve } = confirmState;
    setConfirmState(null);
    resolve(answer);
  }

  function closeAlert(): void {
    if (!alertState) return;
    const { resolve } = alertState;
    setAlertState(null);
    resolve();
  }

  return (
    <Context.Provider value={api}>
      {children}
      {confirmState ? (
        <ModalShell
          title={confirmState.request.title}
          size="default"
          onClose={() => closeConfirm(false)}
          footer={
            <>
              <button className="toolbar-button" type="button" onClick={() => closeConfirm(false)}>
                {confirmState.request.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={confirmState.request.danger ? "primary-action danger" : "primary-action"}
                type="button"
                autoFocus
                onClick={() => closeConfirm(true)}
              >
                {confirmState.request.confirmLabel ?? "Confirm"}
              </button>
            </>
          }
        >
          <div className="modal-message">{confirmState.request.message}</div>
        </ModalShell>
      ) : null}
      {alertState ? (
        <ModalShell
          title={alertState.request.title}
          size="default"
          onClose={closeAlert}
          footer={
            <button className="primary-action" type="button" autoFocus onClick={closeAlert}>OK</button>
          }
        >
          <div className="modal-message">{alertState.request.message}</div>
        </ModalShell>
      ) : null}
    </Context.Provider>
  );
}
