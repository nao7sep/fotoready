import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiVisionProvider } from "@adapters/gemini";
import { visionError } from "@main/queues/vision";

const fetchMock = vi.fn<typeof fetch>();
const key = "test-provider-key";
const opts = { model: "gemini-3.8-flash", descriptionPrompt: "Describe", timeoutMs: 60000, maxRetries: 10, initialBackoffMs: 0 };
const request = { imageBytes: Buffer.from("image"), mimeType: "image/jpeg" as const };
const ok = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A mug." }] } }] }));
const fail = (status: number) => new Response(JSON.stringify({ error: { message: "Please try later." } }), { status, headers: { "Content-Type": "application/json" } });
const run = (overrides = {}) => new GeminiVisionProvider(key, "https://proxy.example/gemini").describeImage(request, { ...opts, ...overrides });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("Gemini requests follow the id, independent of endpoint", () => {
  it.each([
    ["gemini-3.8-flash", { thinkingLevel: "MEDIUM" }],
    ["typed-unknown", undefined]
  ])("builds the %s description request from its branch", async (model, thinkingConfig) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://proxy.example/gemini/v1beta/models/${model}:generateContent`);
    expect(init).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
    expect(new Headers(init!.headers).get("x-goog-api-key")).toBe(key);
    const body = JSON.parse(String(init!.body));
    expect(body.generationConfig ?? {}).toEqual(thinkingConfig ? { thinkingConfig } : {});
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: request.imageBytes.toString("base64") });
  });

  it("asks for the slug JSON format and excludes thought text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: "private reasoning" }, { text: '{"slugs":["a-mug","cup","drink"]}' }] } }] })));
    await expect(new GeminiVisionProvider(key, "https://models.example").suggestSlugs("A mug", { ...opts, model: "gemini-3.5-flash-lite", slugPrompt: "Slugs" })).resolves.toEqual(["a-mug", "cup", "drink"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: expect.objectContaining({ required: ["slugs"] }), thinkingConfig: { thinkingLevel: "MEDIUM" } });
  });

  it("asks for the slug JSON format for an id with no branch", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"slugs":["a-mug","cup","drink"]}' }] } }] })));
    await new GeminiVisionProvider(key, "https://models.example").suggestSlugs("A mug", { ...opts, model: "typed-unknown", slugPrompt: "Slugs" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: expect.objectContaining({ required: ["slugs"] }) });
  });
});

describe("Gemini resend policy", () => {
  it.each([408, 429, 503])("caps %s at three total attempts", async (status) => {
    fetchMock.mockImplementation(async () => fail(status));
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 404, 500, 502, 504])("returns %s to the waiting user without resending", async (status) => {
    fetchMock.mockImplementation(async () => fail(status));
    await expect(run()).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])("retries the unsent connection failure %s", async (code) => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code } })).mockImplementation(async () => ok());
    await expect(run()).resolves.toBe("A mug.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT"])("does not resend an unknown outcome %s", async (code) => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: { code } }));
    await expect(run()).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds a stalled call and does not retry a timeout", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    fetchMock.mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    const work = run();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(timeout).toHaveBeenCalledWith(60000);
    expect(fetchMock).toHaveBeenCalledOnce();
    timeout.mockRestore();
  });

  it.each(["SAFETY", "PROHIBITED_CONTENT"])("returns candidate refusal %s without retries", async (finishReason) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason }] })));
    const error = await run().catch((error) => error);
    expect(error).toMatchObject({ code: "safety-refusal" });
    expect(visionError(error, "description").retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
