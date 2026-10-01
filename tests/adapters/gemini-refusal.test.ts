import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn<typeof fetch>();
import { GeminiVisionProvider } from "@adapters/gemini";

const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const text = (value: string, finishReason?: string) => response({ candidates: [{ ...(finishReason ? { finishReason } : {}), content: { parts: [{ text: value }] } }] });

const CALL = { timeoutMs: 1000, maxRetries: 0, initialBackoffMs: 1 };
const describeImage = () => new GeminiVisionProvider("fake-provider-key", "https://models.example").describeImage(
  { imageBytes: Buffer.from("x"), mimeType: "image/jpeg" },
  { ...CALL, model: "gemini-3.8-flash", descriptionPrompt: "p" });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

// A refusal reported as "empty description" describes our parser, not the cause. Only the
// provider's own reason tells the user the image was rejected and they must change it.
describe("a refused or truncated vision response reports the provider's reason", () => {
  it("surfaces a prompt-level block", async () => {
    fetchMock.mockImplementation(async () => response({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    await expect(describeImage()).rejects.toThrow(/refused this image \(PROHIBITED_CONTENT\)/);
    await expect(describeImage()).rejects.not.toThrow(/empty description/);
  });

  it("names a truncated description rather than returning it as complete", async () => {
    fetchMock.mockImplementation(async () => text("a mug on a", "MAX_TOKENS"));
    await expect(describeImage()).rejects.toThrow(/truncated/);
  });

  it("passes a normal stop through, and a response with no finishReason", async () => {
    fetchMock.mockImplementation(async () => text("A mug.", "STOP"));
    await expect(describeImage()).resolves.toBe("A mug.");
    fetchMock.mockImplementation(async () => text("A mug."));
    await expect(describeImage()).resolves.toBe("A mug.");
  });

  it("keeps the genuine empty-response error when nothing explains it", async () => {
    fetchMock.mockImplementation(async () => text(""));
    await expect(describeImage()).rejects.toThrow(/empty description/);
  });
});
