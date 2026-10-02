// Turns any value a log line or record carries into a JSON-safe structure: errors expanded to
// their type, message, stack, own properties and cause chain; Maps and Sets to their entries;
// binary blobs summarized; cycles cut.

/** A JSON-safe copy of `value`. Never throws. */
export function jsonSafe(value: unknown): unknown {
  return transform(value, new WeakSet<object>());
}

/** A JSON-safe copy of a field bag, with a null prototype so a `__proto__` field stays data. */
export function jsonSafeObject(obj: Record<string, unknown>): Record<string, unknown> {
  return transformObject(obj, new WeakSet<object>());
}

function serializeError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  // Standard fields first, then any own-enumerable diagnostic props the error
  // carries (Node's `code` / `errno` / `syscall` / `path`, an HTTP `status`,
  // etc.) — often the most useful part of a post-mortem, and otherwise lost.
  // Routed through transformObject so the cause chain (which may itself be an
  // Error) is expanded recursively.
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
  if (error instanceof AggregateError) raw.errors = error.errors;
  return transformObject(raw, seen);
}

// Pure, total, type-preserving: turns an arbitrary value into a JSON-safe,
// error-expanded structure. Never throws, never scans string content,
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
    const transformed = transform(val, seen);
    if (transformed !== undefined) out[key] = transformed;
  }
  return out;
}
