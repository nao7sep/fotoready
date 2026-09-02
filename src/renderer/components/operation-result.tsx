import React from "react";
import { AlertTriangle, CircleAlert, Info } from "lucide-react";

export type OperationResultSeverity = "error" | "info" | "warning";

export function OperationResult({
  children,
  className,
  severity,
  announce = true
}: {
  children: React.ReactNode;
  className?: string;
  severity: OperationResultSeverity;
  /** Progress and other continuously changing state stays visible without becoming a live region. */
  announce?: boolean;
}): React.JSX.Element {
  const role = announce ? (severity === "error" ? "alert" : "status") : undefined;
  const Icon = severity === "error" ? CircleAlert : severity === "warning" ? AlertTriangle : Info;

  return (
    <div
      aria-atomic={role ? "true" : undefined}
      className={`operation-result operation-result-${severity}${className ? ` ${className}` : ""}`}
      role={role}
    >
      <Icon aria-hidden="true" className="operation-result-icon" size={15} />
      <span className="sr-only">{severityLabel(severity)}: </span>
      <div className="operation-result-content">{children}</div>
    </div>
  );
}

function severityLabel(severity: OperationResultSeverity): string {
  if (severity === "error") return "Error";
  if (severity === "warning") return "Warning";
  return "Information";
}
