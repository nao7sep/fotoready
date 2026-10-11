import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { geminiDiagnostic } from "@adapters/gemini-diagnostic";

const key = "sent-provider-credential";

describe("Gemini diagnostic copies", () => {
  it("preserves SDK classification, cause and retry facts without changing the original error", () => {
    const error = new ApiError({ status: 503, message: JSON.stringify({ error: { message: `Echo ${key}`, authorization: "another-secret" } }) });
    error.cause = Object.assign(new Error(`Cause ${key}`), { code: "ECONNREFUSED", api_key: "cause-secret" });
    const safe = geminiDiagnostic(error, key);
    expect(safe).toBeInstanceOf(ApiError);
    expect(safe).toMatchObject({ status: 503, cause: { code: "ECONNREFUSED", api_key: "[REDACTED]" } });
    expect(safe.message).toContain("[REDACTED]");
    expect(safe.stack).not.toContain("another-secret");
    expect(safe.cause).toBeInstanceOf(Error);
    expect(error.message).toContain(key);
    expect(error.cause).toMatchObject({ api_key: "cause-secret" });
  });

  it("masks known fields and exact key echoes in successful diagnostic bodies, leaving content and the live body intact", () => {
    const response = { text: `A harbor ${key}`, nested: [{ "x-goog-api-key": "other-key", access_token: "other-token", duration: 15 }], usageMetadata: { totalTokenCount: 7 } };
    const safe = geminiDiagnostic(response, key);
    expect(safe).toEqual({ text: "A harbor [REDACTED]", nested: [{ "x-goog-api-key": "[REDACTED]", access_token: "[REDACTED]", duration: 15 }], usageMetadata: { totalTokenCount: 7 } });
    expect(response.text).toContain(key);
    expect(response.nested[0]!["x-goog-api-key"]).toBe("other-key");
  });
});
