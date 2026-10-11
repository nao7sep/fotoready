import React, { useId } from "react";
import { ModalShell } from "./modal-shell";
import { OperationResult } from "../operation-result";
import { useI18n } from "@renderer/i18n/I18nContext";
import { useImeGuard } from "@renderer/utils/ime-guard";

export function GeminiKeyModal({ draft, saving, failed, onChange, onClose, onSave }: {
  draft: string;
  saving: boolean;
  failed: boolean;
  onChange(value: string): void;
  onClose(): void;
  onSave(): void;
}): React.JSX.Element {
  const { t } = useI18n();
  const ime = useImeGuard();
  const inputId = useId();
  const helpId = useId();
  return <ModalShell title={t("geminiKey.title")} size="small" closeDisabled={saving} onClose={onClose}
    footer={<>
      <button type="button" className="toolbar-button" disabled={saving} onClick={onClose}>{t("geminiKey.notNow")}</button>
      <button type="button" className="primary-action" disabled={saving || !draft.trim()} onClick={onSave}>{t(saving ? "common.saving" : "common.save")}</button>
    </>}>
    <p id={helpId} className="field-help">{t("geminiKey.message")}</p>
    <label className="stacked-field" htmlFor={inputId}>
      {t("settings.apiKey")}
      <input id={inputId} type="password" autoFocus autoComplete="off" spellCheck={false}
        value={draft} disabled={saving} aria-describedby={helpId}
        onChange={(event) => onChange(event.currentTarget.value)} {...ime.compositionProps}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !ime.isComposing(event)) {
            event.preventDefault();
            if (!saving && draft.trim()) onSave();
          }
        }} />
    </label>
    {failed ? <OperationResult severity="error">{t("geminiKey.saveFailure")}</OperationResult> : null}
  </ModalShell>;
}
