import fs from "node:fs";
import path from "node:path";
import { nowIso, utcStamp } from "@shared/time";
import type { LogFields, LogLevel, Logger } from "@shared/types/log";

export interface AppLogger extends Logger {
  /**
   * Close the session file handle. Writes are synchronous, so there is nothing
   * buffered to flush — this only releases the descriptor. Idempotent and
   * best-effort; safe to call from exit hooks.
   */
  close(): void;
}

export type CreateLoggerOptions = {
  /**
   * Whether developer-only `debug` lines are written. Computed by the caller
   * from the build/runtime (unpackaged dev build or `FOTOREADY_DEBUG=1`); when
   * false, `debug` calls are dropped before they touch the disk.
   */
  debug: boolean;
};

// Non-destructive redaction denied-key set: exact, case-insensitive field-name
// matches (stored lower-cased). Seeded with the obvious secret-bearing names —
// including the common compound token/secret forms — and the app's own Gemini
// key field. fotoready never logs key *values* directly; this is the backstop
// for the day a whole object carrying one gets logged.
const REDACTED_KEYS = new Set([
  "apikey",
  "apikeys",
  "geminiapikey",
  "authorization",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
  "sessiontoken",
  "password",
  "passphrase",
  "secret",
  "clientsecret",
  "apisecret",
  "privatekey",
  "credential",
  "credentials"
]);

const REDACTED = "[redacted]";

// Envelope fields are the only fixed contract; user fields may never overwrite them.
const ENVELOPE_KEYS = new Set(["time", "level", "message"]);

function serializeError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  // Standard fields first, then any own-enumerable diagnostic props the error
  // carries (Node's `code` / `errno` / `syscall` / `path`, an HTTP `status`,
  // etc.) — often the most useful part of a post-mortem, and otherwise lost.
  // Routed through transformObject so denied keys on the error are redacted and
  // the cause chain (which may itself be an Error) is expanded recursively.
  const raw: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack ?? null
  };
  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    raw[key] = value;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) raw.cause = cause;
  return transformObject(raw, seen);
}

// Pure, total, type-preserving: turns an arbitrary value into a JSON-safe,
// redacted, error-expanded structure. Never throws, never scans string content,
// and guards against cycles so a self-referential field cannot blow the stack.
function transform(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") return Number.isFinite(value as number) ? value : String(value);
  if (type === "bigint") return (value as bigint).toString();
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;

  if (value instanceof Error) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = serializeError(value, seen);
    seen.delete(value);
    return out;
  }
  if (value instanceof Date) return value.toISOString();

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    // Summarize binary blobs — never dump raw bytes into a log line.
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? "Binary";
    return `[${ctor} bytes=${value.byteLength}]`;
  }
  if (value instanceof Map) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = Array.from(value.entries()).map(([key, val]) => [transform(key, seen), transform(val, seen)]);
    seen.delete(value);
    return out;
  }
  if (value instanceof Set) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = Array.from(value.values()).map((item) => transform(item, seen));
    seen.delete(value);
    return out;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = value.map((item) => transform(item, seen));
    seen.delete(value);
    return out;
  }

  if (type === "object") {
    const obj = value as object;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);
    const out = transformObject(obj as Record<string, unknown>, seen);
    seen.delete(obj);
    return out;
  }

  return String(value);
}

function transformObject(obj: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  // Null-prototype accumulator so a field literally named "__proto__" (or
  // "constructor") becomes an own key instead of mutating the prototype — this
  // both preserves the field and removes any prototype-pollution footgun. JSON
  // serializes own enumerable keys regardless of prototype.
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    const transformed = transform(val, seen);
    if (transformed !== undefined) out[key] = transformed;
  }
  return out;
}

function buildLine(level: LogLevel, message: string, fields?: LogFields): string {
  // Null-prototype envelope (see transformObject). Envelope keys are written
  // first for readability, then the redacted user fields, with reserved envelope
  // names dropped so fields can never shadow the contract.
  const line: Record<string, unknown> = Object.create(null);
  line.time = nowIso();
  line.level = level;
  line.message = message;
  if (fields) {
    const safe = transformObject(fields, new WeakSet<object>());
    for (const [key, val] of Object.entries(safe)) {
      if (ENVELOPE_KEYS.has(key)) continue;
      line[key] = val;
    }
  }
  return `${JSON.stringify(line)}\n`;
}

/**
 * One log file per launch under `logsDir`, named with a UTC session-start millisecond stamp
 * (`yyyymmdd-hhmmss-fff-utc.log`, per the timestamp-conventions). Every line is one JSON object. Writes are
 * synchronous, so the last lines before a crash are already on disk — no buffer
 * to lose. If the file can't be opened or a write fails, the logger degrades to
 * the console and keeps running; it never throws and never silently swallows a
 * logging failure.
 */
export function createLogger(logsDir: string, options: CreateLoggerOptions): AppLogger {
  const { debug } = options;
  let fd: number | null = null;
  let fileFailed = false;

  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fd = fs.openSync(path.join(logsDir, `${utcStamp()}.log`), "a");
  } catch (error) {
    fileFailed = true;
    console.error("[logger] could not open the session log file; logging to console only", error);
  }

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (level === "debug" && !debug) return;

    let line: string;
    try {
      line = buildLine(level, message, fields);
    } catch (error) {
      // Serialization itself failed — logging must never throw or crash the app.
      console.error("[logger] failed to serialize a log entry", { level, message }, error);
      return;
    }

    if (fd !== null) {
      try {
        fs.writeSync(fd, line);
        return;
      } catch (error) {
        if (!fileFailed) {
          fileFailed = true;
          console.error("[logger] log file write failed; falling back to the console", error);
        }
      }
    }

    // Best-effort console fallback when the file is unavailable. No new deps.
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    sink(line.trimEnd());
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    close: () => {
      // Idempotent: nulling fd makes a second call (and a call after a failed
      // open) a no-op.
      if (fd === null) return;
      const handle = fd;
      fd = null;
      try {
        fs.closeSync(handle);
      } catch (error) {
        console.error("[logger] failed to close the session log file", error);
      }
    }
  };
}

/**
 * Global last-resort hooks: log the failure with full fidelity before the
 * process dies, then preserve default behavior (re-throw uncaught exceptions,
 * mark a non-zero exit code for unhandled rejections). The descriptor is closed
 * on `exit`. Called exactly once per launch — `bootstrap` runs a single time and
 * only the window is recreated on macOS re-activate, so there is no second logger
 * to swap in.
 */
export function installCrashHandlers(logger: AppLogger): void {
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { mod: "main", err: error });
    logger.close();
    throw error;
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", { mod: "main", err: reason });
    process.exitCode = 1;
  });

  process.on("exit", () => {
    logger.close();
  });
}
