import React from "react";
import { useI18n } from "@renderer/i18n/I18nContext";
import { OperationResult } from "./operation-result";
import type { OwnedFailures } from "../owned-failures";

export function OwnedFailureList({
  className,
  failures,
  onDismiss
}: {
  className?: string;
  failures: OwnedFailures;
  onDismiss(key: string): void;
}): React.JSX.Element | null {
  const { t, text } = useI18n();
  const entries = Object.entries(failures);
  if (entries.length === 0) return null;
  return (
    <div className={`owned-failure-list${className ? ` ${className}` : ""}`}>
      {entries.map(([key, message]) => (
        <OperationResult
          className="modal-error"
          dismissLabel={t("common.closeActionResult")}
          key={key}
          severity="error"
          onDismiss={() => onDismiss(key)}
        >
          {text(message)}
        </OperationResult>
      ))}
    </div>
  );
}
