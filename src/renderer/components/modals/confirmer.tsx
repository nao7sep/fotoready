import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./confirm-modal";
import { AlertModal } from "./alert-modal";

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
  const confirmRef = useRef<ConfirmState | null>(null);
  const alertRef = useRef<AlertState | null>(null);
  const confirmQueue = useRef<ConfirmState[]>([]);
  const alertQueue = useRef<AlertState[]>([]);
  confirmRef.current = confirmState;
  alertRef.current = alertState;

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      const next = { request, resolve };
      if (!confirmRef.current) {
        confirmRef.current = next;
        setConfirmState(next);
      } else {
        confirmQueue.current.push(next);
      }
    });
  }, []);

  const alert = useCallback((request: AlertRequest) => {
    return new Promise<void>((resolve) => {
      const next = { request, resolve };
      if (!alertRef.current) {
        alertRef.current = next;
        setAlertState(next);
      } else {
        alertQueue.current.push(next);
      }
    });
  }, []);

  const api = useMemo<ConfirmerApi>(() => ({ confirm, alert }), [confirm, alert]);

  // If the host unmounts (app teardown), every awaiting caller must still settle. Resolve through
  // the safe path: pending and queued confirms answer "no", pending and queued alerts resolve.
  useEffect(() => {
    return () => {
      if (confirmRef.current) confirmRef.current.resolve(false);
      confirmQueue.current.forEach((entry) => entry.resolve(false));
      confirmQueue.current = [];
      if (alertRef.current) alertRef.current.resolve();
      alertQueue.current.forEach((entry) => entry.resolve());
      alertQueue.current = [];
    };
  }, []);

  function closeConfirm(answer: boolean): void {
    const current = confirmRef.current;
    if (!current) return;
    const next = confirmQueue.current.shift() ?? null;
    confirmRef.current = next;
    setConfirmState(next);
    current.resolve(answer);
  }

  function closeAlert(): void {
    const current = alertRef.current;
    if (!current) return;
    const next = alertQueue.current.shift() ?? null;
    alertRef.current = next;
    setAlertState(next);
    current.resolve();
  }

  return (
    <Context.Provider value={api}>
      {children}
      {confirmState ? (
        <ConfirmModal request={confirmState.request} onClose={closeConfirm} />
      ) : null}
      {alertState ? (
        <AlertModal request={alertState.request} onClose={closeAlert} />
      ) : null}
    </Context.Provider>
  );
}
