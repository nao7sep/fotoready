import { ApiError } from "@google/genai";
import { isRecord } from "@shared/validation/common";

/** The provider's documented error.message field, separate from SDK/transport diagnostics. */
export class GeminiApiError extends ApiError {
  constructor(status: number, diagnostic: string, readonly providerMessage: string | null, readonly retryAfter: string | null) {
    super({ status, message: diagnostic });
    // The SDK constructor restores its own prototype, even on subclasses.
    Object.setPrototypeOf(this, GeminiApiError.prototype);
  }
}

export function geminiUrl(endpoint: string, route: string): URL {
  return new URL(`${endpoint.replace(/\/+$/, "")}/v1beta/${route}`);
}

export async function geminiRequest(url: URL, apiKey: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-goog-api-key": apiKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal
  });
  const raw = await response.text();
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch (error) {
    if (response.ok) throw new Error("Gemini returned a non-JSON response.", { cause: error });
  }
  if (!response.ok) {
    const reason = isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
      ? data.error.message : null;
    // Only the documented service reason may be shown. Diagnostic-shaped text,
    // paths, and a credential echoed by a proxy remain in the diagnostic error.
    const safeReason = reason && !reason.includes(apiKey) &&
      !/Error invoking|\b(?:EACCES|ENOENT|ENOSPC)\b|\bat .+\(.+:\d+|(?:\/Users\/|\/private\/|\/tmp\/|\/var\/|\/home\/)|[A-Za-z]:\\/i.test(reason)
      ? reason : null;
    throw new GeminiApiError(response.status, (reason ?? `Gemini request failed (${response.status}).`).replaceAll(apiKey, "[redacted]"), safeReason, response.headers.get("retry-after"));
  }
  return data;
}
