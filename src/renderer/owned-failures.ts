import type React from "react";
import { presentFailure } from "./present-failure";

export type OwnedFailures = Record<string, string>;
export type OwnedFailureSetter = React.Dispatch<React.SetStateAction<OwnedFailures>>;
export type OwnedActionOutcome = "completed" | "cancelled";

const actionAttempts = new WeakMap<OwnedFailureSetter, Map<string, number>>();

function beginAttempt(setFailures: OwnedFailureSetter, key: string): number {
  let attempts = actionAttempts.get(setFailures);
  if (!attempts) {
    attempts = new Map();
    actionAttempts.set(setFailures, attempts);
  }
  const attempt = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, attempt);
  return attempt;
}

function isLatestAttempt(setFailures: OwnedFailureSetter, key: string, attempt: number): boolean {
  return actionAttempts.get(setFailures)?.get(key) === attempt;
}

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
  const attempt = beginAttempt(setFailures, key);
  try {
    const outcome = await action();
    if (outcome === "cancelled") return;
    if (isLatestAttempt(setFailures, key, attempt)) dismissOwnedFailure(setFailures, key);
  } catch (error) {
    const message = presentFailure(error, userMessage, operation, fields);
    if (!isLatestAttempt(setFailures, key, attempt)) return;
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
