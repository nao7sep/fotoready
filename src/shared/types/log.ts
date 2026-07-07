export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/**
 * The write surface every part of the app logs through. The concrete
 * implementation — file handle, JSON-Lines serialization, redaction, the
 * debug gate, console fallback — lives in the privileged main process (see
 * `@main/logger`). Inner rings (adapters, queues, services) depend only on this
 * port, never on the implementation, so the dependency points inward.
 *
 * The call takes a short, stable `message` plus an optional bag of structured
 * `fields`; the logger owns serialization. Any `Error` placed in `fields` is
 * expanded to its type / message / stack / cause chain by the serializer, so
 * callers pass the error object itself rather than `String(error)`.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
