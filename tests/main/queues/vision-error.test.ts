import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";

import { VisionProviderFailure } from "@adapters/gemini";
import { visionError } from "@main/queues/vision";

describe("visionError", () => {
  it("maps a missing model from the SDK status, independent of diagnostic prose", () => {
    const result = visionError(new ApiError({
      status: 404,
      message: "Error invoking remote method: EACCES /private/tmp/FOTOREADY_MODEL_SENTINEL",
    }));

    expect(result.message).toBe("This Gemini model isn't available. Open Settings and choose one from the list.");
    expect(result.retryable).toBe(false);
    expect(result.message).not.toMatch(/EACCES|private\/tmp|SENTINEL|invoking remote method/i);
    expect(result.detail).toContain("FOTOREADY_MODEL_SENTINEL");
  });

  it("maps authentication, throttling, and server failures from SDK statuses", () => {
    expect(visionError(new ApiError({ status: 403, message: "hostile auth prose" }))).toMatchObject({
      message: "Gemini authentication failed. Check the saved API key in Settings, then retry.", retryable: true,
    });
    expect(visionError(new ApiError({ status: 429, message: "hostile quota prose" }))).toMatchObject({
      message: "Gemini rate limit reached. Wait a moment, then retry.", retryable: true,
    });
    expect(visionError(new ApiError({ status: 503, message: "hostile server prose" }))).toMatchObject({
      message: "Gemini is temporarily unavailable. Retry in a moment.", retryable: true,
    });
  });

  it("maps app-local provider codes without parsing their messages", () => {
    expect(visionError(new VisionProviderFailure("missing-api-key", "hostile missing key prose"))).toMatchObject({
      message: "Gemini API key is missing. Open Settings and save a key, then retry.", retryable: true,
    });
    expect(visionError(new VisionProviderFailure("safety-refusal", "hostile safety prose"))).toMatchObject({
      message: "Gemini refused this image because of a safety or content policy restriction.", retryable: false,
    });
    expect(visionError(new VisionProviderFailure("invalid-response", "hostile JSON prose"))).toMatchObject({
      message: "Gemini returned an unexpected response. Retry, or adjust the configured model if the problem persists.", retryable: true,
    });
  });

  it("does not classify a bare exception by suggestive prose", () => {
    const result = visionError(new Error(
      "model is not found; blocked by safety; Error invoking remote method: EACCES /private/tmp/FOTOREADY_VISION_SENTINEL",
    ));

    expect(result.message).toBe(
      "FotoReady could not analyze this image. The current metadata and saved files are unchanged; try again.",
    );
    expect(result.retryable).toBe(true);
    expect(result.message).not.toMatch(/EACCES|private\/tmp|FOTOREADY_VISION_SENTINEL|invoking remote method/i);
    expect(result.detail).toContain("FOTOREADY_VISION_SENTINEL");
  });
});
