// Gemini-compatible endpoints may echo authentication in responses or errors. Mask at the
// request owner, which knows the key, before either provider records or outer error logs see it.
// This is a diagnostic copy only: the live request and successful result are never rewritten.
const CREDENTIAL_FIELDS = new Set(["apikey", "xgoogapikey", "authorization", "proxyauthorization", "accesstoken", "refreshtoken"]);

export function geminiDiagnostic<T>(value: T, apiKey: string): T {
  const seen = new WeakMap<object, unknown>();
  const text = (value: string): string => apiKey ? value.replaceAll(apiKey, "[REDACTED]") : value;
  const messageCopy = (message: string): string => {
    if (!message.trimStart().startsWith("{")) return text(message);
    let body: unknown;
    try { body = JSON.parse(message); } catch { return text(message); }
    return JSON.stringify(copy(body));
  };
  const copy = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      result.push(...value.map(copy));
      return result;
    }
    // Keep SDK error identity for status-based retry and user-facing classification. Explicit
    // own fields also preserve non-enumerable Error diagnostics without retaining the raw cause.
    const result = Object.create(value instanceof Error ? Object.getPrototypeOf(value) : null) as Record<string, unknown>;
    seen.set(value, result);
    const fields: Record<string, unknown> = { ...value };
    if (value instanceof Error) {
      // ApiError.message contains the endpoint's JSON body. Its structured credential
      // fields need the same treatment as response objects, including the stack's first line.
      const message = messageCopy(value.message);
      Object.assign(fields, {
        name: value.name,
        message,
        stack: value.stack?.replace(value.message, message)
      });
      if (value.cause !== undefined) fields.cause = value.cause;
      if (value instanceof AggregateError) fields.errors = value.errors;
    }
    for (const [key, item] of Object.entries(fields)) {
      const credential = CREDENTIAL_FIELDS.has(key.toLowerCase().replaceAll(/[-_]/g, ""));
      Object.defineProperty(result, text(key), { value: credential ? "[REDACTED]" : key === "message" && typeof item === "string" ? messageCopy(item) : copy(item), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  return copy(value) as T;
}
