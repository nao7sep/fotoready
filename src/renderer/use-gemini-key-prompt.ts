import { useEffect, useRef, useState } from "react";
import { useConfirmer } from "./components/modals/confirmer";
import { useI18n } from "./i18n/I18nContext";

type PendingKey = { resolve(ready: boolean): void; reject(error: unknown): void };

/** Only explicit AI commands call this owner; export and startup never request a key. */
export function useGeminiKeyPrompt({ hasKey, saveKey, onStored }: {
  hasKey(): Promise<boolean>;
  saveKey(key: string): Promise<void>;
  onStored(): void;
}) {
  const { t } = useI18n();
  const confirmer = useConfirmer();
  const [view, setView] = useState<{ draft: string; saving: boolean; failed: boolean } | null>(null);
  const draft = useRef("");
  const pending = useRef<PendingKey | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const closing = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.resolve(false);
      pending.current = null;
      draft.current = "";
    };
  }, []);

  function finish(ready: boolean): void {
    const request = pending.current;
    pending.current = null;
    draft.current = "";
    if (mounted.current) setView(null);
    request?.resolve(ready);
  }

  function ensureKey(): Promise<boolean> {
    // Repeated clicks must not resume two paid commands from one prompt.
    if (!mounted.current || pending.current || closing.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      const request = { resolve, reject };
      pending.current = request;
      void Promise.resolve().then(hasKey).then((available) => {
        if (!mounted.current || pending.current !== request) return;
        if (available) finish(true);
        else setView({ draft: "", saving: false, failed: false });
      }, (error: unknown) => {
        if (pending.current !== request) return;
        pending.current = null;
        if (mounted.current) setView(null);
        reject(error);
      });
    });
  }

  function changeDraft(value: string): void {
    if (saving.current || closing.current) return;
    draft.current = value;
    setView({ draft: value, saving: false, failed: false });
  }

  function save(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (!pending.current || !draft.current.trim() || closing.current) return Promise.resolve(false);
    const value = draft.current.trim();
    setView({ draft: draft.current, saving: true, failed: false });
    const operation = (async () => {
      try {
        await Promise.resolve().then(() => saveKey(value));
        if (mounted.current) {
          onStored();
          draft.current = "";
          // The quit owner waits for this save but must not launch fresh AI work.
          if (!closing.current) finish(true);
          else setView({ draft: "", saving: false, failed: false });
        }
        return true;
      } catch {
        // The IPC owner records storage diagnostics. Never echo a submitted key
        // or an arbitrary exception containing it into UI or renderer logs.
        if (mounted.current) setView({ draft: draft.current, saving: false, failed: true });
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = operation;
    return operation;
  }

  function requestClose(): Promise<boolean> {
    if (closing.current) return closing.current;
    if (!pending.current) return Promise.resolve(true);
    const operation = (async () => {
      if (saving.current && !await saving.current) return false;
      if (!mounted.current) return false;
      if (draft.current.trim() && !await confirmer.confirm({
        title: t("confirm.discardSettings.title"),
        message: t("confirm.discardSettings.message"),
        confirmLabel: t("common.discard"),
        cancelLabel: t("common.keepEditing"),
        danger: true,
      })) return false;
      finish(false);
      return true;
    })();
    closing.current = operation;
    void operation.then(() => { closing.current = null; }, () => { closing.current = null; });
    return operation;
  }

  return { view, ensureKey, changeDraft, save, requestClose };
}
