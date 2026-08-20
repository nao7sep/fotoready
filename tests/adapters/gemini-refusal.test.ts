import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { models = { generateContent }; },
  Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING" },
}));

import { GeminiVisionProvider } from "@adapters/gemini";

const CALL = { timeoutMs: 1000, maxRetries: 0, initialBackoffMs: 1 };
const describeImage = () => new GeminiVisionProvider("k").describeImage(
  { imageBytes: Buffer.from("x"), mimeType: "image/jpeg" },
  { ...CALL, model: "gemini-3.7-flash", descriptionPrompt: "p" });

beforeEach(() => generateContent.mockReset());

// A refusal reported as "empty description" describes our parser, not the cause. Only the
// provider's own reason tells the user the image was rejected and they must change it.
describe("a refused or truncated vision response reports the provider's reason", () => {
  it("surfaces a prompt-level block", async () => {
    generateContent.mockResolvedValue({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } });
    await expect(describeImage()).rejects.toThrow(/refused this image \(PROHIBITED_CONTENT\)/);
    await expect(describeImage()).rejects.not.toThrow(/empty description/);
  });

  it("names a truncated description rather than returning it as complete", async () => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason: "MAX_TOKENS" }], text: "a mug on a" });
    await expect(describeImage()).rejects.toThrow(/truncated/);
  });

  it("passes a normal stop through, and a response with no finishReason", async () => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason: "STOP" }], text: "A mug." });
    await expect(describeImage()).resolves.toBe("A mug.");
    generateContent.mockResolvedValue({ text: "A mug." });
    await expect(describeImage()).resolves.toBe("A mug.");
  });

  it("keeps the genuine empty-response error when nothing explains it", async () => {
    generateContent.mockResolvedValue({ text: "" });
    await expect(describeImage()).rejects.toThrow(/empty description/);
  });
});
