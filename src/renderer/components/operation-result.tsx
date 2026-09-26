import React from "react";
import { X } from "lucide-react";
import { useI18n } from "@renderer/i18n/I18nContext";

export type OperationResultSeverity = "error" | "info" | "warning";

export function OperationResult({
  children,
  className,
  severity,
  announce = true,
  onDismiss,
  dismissLabel
}: {
  children: React.ReactNode;
  className?: string;
  severity: OperationResultSeverity;
  /** Progress and other continuously changing state stays visible without becoming a live region. */
  announce?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const role = announce ? (severity === "error" ? "alert" : "status") : undefined;

  return (
    <div
      aria-atomic={role ? "true" : undefined}
      className={`operation-result operation-result-${severity}${className ? ` ${className}` : ""}`}
      role={role}
    >
      <div className="operation-result-content">{children}</div>
      {onDismiss ? (
        <button
          aria-label={dismissLabel ?? t("common.closeResult")}
          className="operation-result-dismiss"
          type="button"
          onClick={onDismiss}
        >
          <X className="operation-result-close-icon" />
        </button>
      ) : null}
    </div>
  );
}
