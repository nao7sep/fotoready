import { describe, expect, it } from "vitest";
import { visionError } from "@main/queues/vision";

/** The shape @google/genai throws: a status plus the provider's own payload. */
function apiError(status: number, message: string): Error & { status: number; error: unknown } {
  const error = new Error(message) as Error & { status: number; error: unknown };
  error.status = status;
  error.error = { code: status, message };
  return error;
}

const NOT_FOUND = `{"error":{"code":404,"message":"models/gemini-3-flash-preview is not found for API version v1beta"}}`;

describe("visionError — a model that no longer exists", () => {
  // Closing the model list made this the likeliest failure, not the rarest: every id retires, two of
  // the four shipped are -preview, and there is no models reset — so a config stays pinned to its pick
  // while the app's list moves on. Both assertions below failed before 2026-07-16.

  it("says which knob fixes it, instead of handing back the raw payload", () => {
    const { message } = visionError(apiError(404, NOT_FOUND));
    expect(message).toBe("This Gemini model isn't available. Open Settings and choose one from the list.");
    expect(message).not.toContain("{");
  });

  it("is not retryable — the same call fails identically forever", () => {
    // The classifier's default is an optimistic `return true`, which is right for an unknown error
    // and wrong here: it offers a retry that cannot succeed.
    expect(visionError(apiError(404, NOT_FOUND)).retryable).toBe(false);
  });

  it("classifies on the payload even when the status is absent", () => {
    const bare = new Error(NOT_FOUND);
    const { message, retryable } = visionError(bare);
    expect(message).toBe("This Gemini model isn't available. Open Settings and choose one from the list.");
    expect(retryable).toBe(false);
  });

  it("stages as vision and keeps the payload in detail, not in the message", () => {
    const result = visionError(apiError(404, NOT_FOUND));
    expect(result.stage).toBe("vision");
    expect(result.occurredAt).toBeTruthy();
  });
});

describe("visionError — the arms it must not steal", () => {
  // The 404 arm sits above the \bjson\b test (which a 404 payload can match), so the neighbours it
  // jumped in front of are pinned here.

  it("a rate limit stays a retryable rate limit", () => {
    const result = visionError(apiError(429, "Resource has been exhausted"));
    expect(result.message).toBe("Gemini rate limit reached. Wait a moment, then retry.");
    expect(result.retryable).toBe(true);
  });

  it("an auth failure stays a retryable auth failure", () => {
    const result = visionError(apiError(403, "permission denied"));
    expect(result.message).toBe("Gemini authentication failed. Check the saved API key in Settings, then retry.");
    expect(result.retryable).toBe(true);
  });

  it("a malformed response stays the retryable json message", () => {
    const result = visionError(new Error("Vision provider returned an invalid describe response."));
    expect(result.message).toBe("Gemini returned an unexpected response. Retry, or adjust the configured model if the problem persists.");
    expect(result.retryable).toBe(true);
  });

  it("a safety refusal stays non-retryable", () => {
    const result = visionError(apiError(400, "blocked by safety policy"));
    expect(result.retryable).toBe(false);
  });

  it("a server error stays retryable", () => {
    const result = visionError(apiError(503, "backend unavailable"));
    expect(result.message).toBe("Gemini is temporarily unavailable. Retry in a moment.");
    expect(result.retryable).toBe(true);
  });
});
