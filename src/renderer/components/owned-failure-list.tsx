import React from "react";
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
  const entries = Object.entries(failures);
  if (entries.length === 0) return null;
  return (
    <div className={`owned-failure-list${className ? ` ${className}` : ""}`}>
      {entries.map(([key, message]) => (
        <OperationResult
          className="modal-error"
          dismissLabel="Close action result"
          key={key}
          severity="error"
          onDismiss={() => onDismiss(key)}
        >
          {message}
        </OperationResult>
      ))}
    </div>
  );
}
