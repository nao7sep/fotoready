import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";

import { VisionProviderFailure } from "@adapters/gemini";
import { visionError } from "@main/queues/vision";

const providerError = (status: number, canonical: string, text: string) => new ApiError({
  status, message: JSON.stringify({ error: { code: status, message: text, status: canonical } }),
});

describe("visionError", () => {
  it("maps a missing model from the SDK status, independent of diagnostic prose", () => {
    const result = visionError(new ApiError({
      status: 404,
      message: "Error invoking remote method: EACCES /private/tmp/FOTOREADY_MODEL_SENTINEL",
    }), "description");

    expect(result.message).toEqual({ key: "visionError.modelUnavailable" });
    expect(result.retryable).toBe(false);
    expect(JSON.stringify(result.message)).not.toMatch(/EACCES|private\/tmp|SENTINEL|invoking remote method/i);
    expect(result.detail).toContain("FOTOREADY_MODEL_SENTINEL");
  });

  it("maps authentication, throttling, and server failures from SDK statuses", () => {
    expect(visionError(new ApiError({ status: 403, message: "hostile auth prose" }), "description")).toMatchObject({
      message: { key: "visionError.authentication" }, retryable: true,
    });
    expect(visionError(new ApiError({ status: 429, message: "hostile quota prose" }), "description")).toMatchObject({
      message: { key: "visionError.rateLimit" }, retryable: true,
    });
    expect(visionError(new ApiError({ status: 503, message: "hostile server prose" }), "description")).toMatchObject({
      message: { key: "visionError.serviceUnavailable" }, retryable: true,
    });
  });

  it("keeps the localized message for 401, 429 and 503 when the body carries a provider message", () => {
    for (const [status, key] of [[401, "visionError.authentication"], [429, "visionError.rateLimit"], [503, "visionError.serviceUnavailable"]] as const) {
      expect(visionError(providerError(status, "PROVIDER_STATUS", "Provider sentence."), "description").message).toEqual({ key });
    }
  });

  it("shows the provider's own message for an unknown model id", () => {
    for (const status of [400, 404]) {
      expect(visionError(providerError(status, "NOT_FOUND", "models/typed-unknown is not found."), "description")).toMatchObject({
        message: { key: "visionError.providerReason", values: { reason: "models/typed-unknown is not found." } }, retryable: false,
      });
    }
  });

  it("never shows raw response text the SDK wrapped from a non-JSON body", () => {
    // The SDK's shape for a non-JSON error body: the raw text as message, the HTTP reason phrase as status.
    const wrapped = (status: number, statusText: string) => new ApiError({
      status, message: JSON.stringify({ error: { message: "<html>FOTOREADY_RAW_SENTINEL</html>", code: status, status: statusText } }),
    });
    expect(visionError(wrapped(404, "Not Found"), "description").message).toEqual({ key: "visionError.modelUnavailable" });
    expect(visionError(wrapped(400, "Bad Request"), "description")).toMatchObject({ message: { key: "visionError.generic" }, retryable: false });
    expect(visionError(new ApiError({ status: 404, message: "FOTOREADY_RAW_SENTINEL" }), "description").message).toEqual({ key: "visionError.modelUnavailable" });
  });

  it("maps app-local provider codes without parsing their messages", () => {
    expect(visionError(new VisionProviderFailure("missing-api-key", "hostile missing key prose"), "description")).toMatchObject({
      message: { key: "visionError.missingApiKey" }, retryable: true,
    });
    expect(visionError(new VisionProviderFailure("safety-refusal", "hostile safety prose"), "description")).toMatchObject({
      message: { key: "visionError.safetyRefusal" }, retryable: false,
    });
    expect(visionError(new VisionProviderFailure("invalid-response", "hostile JSON prose"), "description")).toMatchObject({
      message: { key: "visionError.unexpectedResponse" }, retryable: true,
    });
  });

  it("does not classify a bare exception by suggestive prose", () => {
    const result = visionError(new Error(
      "model is not found; blocked by safety; Error invoking remote method: EACCES /private/tmp/FOTOREADY_VISION_SENTINEL",
    ), "description");

    expect(result.message).toEqual({ key: "visionError.generic" });
    expect(result.retryable).toBe(true);
    expect(JSON.stringify(result.message)).not.toMatch(/EACCES|private\/tmp|FOTOREADY_VISION_SENTINEL|invoking remote method/i);
    expect(result.detail).toContain("FOTOREADY_VISION_SENTINEL");
  });
});
