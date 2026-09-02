import { reportRendererLog } from "./renderer-log";

/** Log complete diagnostics while returning stable, authored display copy. */
export function presentFailure(
  error: unknown,
  userMessage: string,
  operation: string,
  fields: Record<string, unknown> = {},
): string {
  const diagnostic = { ...fields, error: describeError(error) };
  reportRendererLog({ level: "error", message: operation, fields: diagnostic });
  return userMessage;
}

function describeError(error: unknown, seen = new WeakSet<object>()): Record<string, unknown> {
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
