import type React from "react";
import { presentFailure } from "./present-failure";

export type OwnedFailures = Record<string, string>;
export type OwnedFailureSetter = React.Dispatch<React.SetStateAction<OwnedFailures>>;
export type OwnedActionOutcome = "completed" | "cancelled";

export async function runOwnedAction({
  action,
  fields,
  key,
  operation,
  setFailures,
  userMessage
}: {
  action(): Promise<void | OwnedActionOutcome>;
  fields?: Record<string, unknown>;
  key: string;
  operation: string;
  setFailures: OwnedFailureSetter;
  userMessage: string;
}): Promise<void> {
  try {
    const outcome = await action();
    if (outcome === "cancelled") return;
    dismissOwnedFailure(setFailures, key);
  } catch (error) {
    const message = presentFailure(error, userMessage, operation, fields);
    setFailures((current) => ({ ...current, [key]: message }));
  }
}

export function dismissOwnedFailure(setFailures: OwnedFailureSetter, key: string): void {
  setFailures((current) => {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
}
