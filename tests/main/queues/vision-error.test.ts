import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";

import { VisionProviderFailure } from "@adapters/gemini";
import { visionError } from "@main/queues/vision";

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
