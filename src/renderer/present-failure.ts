/** Log complete diagnostics while returning stable, authored display copy. */
export function presentFailure(
  error: unknown,
  userMessage: string,
  operation: string,
  fields: Record<string, unknown> = {},
): string {
  try {
    const log = window.api?.system?.log;
    if (typeof log === "function") {
      void log({
        level: "error",
        message: operation,
        fields: { ...fields, error: describeError(error) },
      }).catch(() => {
        // A broken logging bridge must never replace the recovered failure.
      });
    }
  } catch {
    // The privileged IPC boundary already logged invoked-operation errors.
  }
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
