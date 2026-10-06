import { message, type Message } from "@shared/i18n/translate";
import { isIpcFailure } from "@shared/ipc-failure";
import { reportRendererLog } from "./renderer-log";

/**
 * Log complete diagnostics while returning stable, authored display copy (a catalogue message),
 * with a main-authored IpcFailure reason beneath it.
 */
export function presentFailure<T extends Message | null>(
  error: unknown,
  userMessage: T,
  operation: string,
  fields: Record<string, unknown> = {},
): T {
  const diagnostic = { ...fields, error: describeError(error) };
  reportRendererLog({ level: "error", message: operation, fields: diagnostic });
  if (userMessage !== null && isIpcFailure(error)) {
    return message("failure.withReason", { failure: userMessage, reason: error.ipcFailure }) as T;
  }
  return userMessage;
}

export function describeError(error: unknown, seen = new WeakSet<object>()): Record<string, unknown> {
  if (isIpcFailure(error)) return { ipcFailure: error.ipcFailure };
  if (!(error instanceof Error)) return { value: String(error) };
  if (seen.has(error)) return { cause: "circular" };
  seen.add(error);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause === undefined ? {} : { cause: describeError(error.cause, seen) }),
  };
}
