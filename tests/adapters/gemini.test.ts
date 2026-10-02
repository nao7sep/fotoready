import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiVisionProvider, type GeminiCall } from "@adapters/gemini";
import { visionError } from "@main/queues/vision";

const fetchMock = vi.fn<typeof fetch>();
const key = "test-provider-key";
const opts = { model: "gemini-3.8-flash", thinking: "medium" as string | null, descriptionPrompt: "Describe", timeoutMs: 60000, maxRetries: 10, initialBackoffMs: 0 };
const request = { imageBytes: Buffer.from("image"), mimeType: "image/jpeg" as const };
const ok = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A mug." }] } }] }));
const fail = (status: number) => new Response(JSON.stringify({ error: { message: "Please try later." } }), { status, headers: { "Content-Type": "application/json" } });
const stall = (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
});
const recordCall = vi.fn<(call: GeminiCall) => void>();
const run = (overrides = {}) => new GeminiVisionProvider(key, "https://proxy.example/gemini", recordCall).describeImage(request, { ...opts, ...overrides });

beforeEach(() => { fetchMock.mockReset(); recordCall.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Gemini requests follow the id, independent of endpoint", () => {
  it.each([
    ["gemini-3.8-flash", "high", { thinkingLevel: "HIGH" }],
    ["typed-unknown", null, undefined]
  ])("builds the %s description request from its branch", async (model, thinking, thinkingConfig) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model, thinking });
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
    await expect(new GeminiVisionProvider(key, "https://models.example", recordCall).suggestSlugs("A mug", { ...opts, model: "gemini-3.5-flash-lite", thinking: "minimal", slugPrompt: "Slugs" })).resolves.toEqual(["a-mug", "cup", "drink"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: expect.objectContaining({ required: ["slugs"] }), thinkingConfig: { thinkingLevel: "MINIMAL" } });
  });

  it("asks for the slug JSON format for an id with no branch", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"slugs":["a-mug","cup","drink"]}' }] } }] })));
    await new GeminiVisionProvider(key, "https://models.example", recordCall).suggestSlugs("A mug", { ...opts, model: "typed-unknown", thinking: null, slugPrompt: "Slugs" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: expect.objectContaining({ required: ["slugs"] }) });
  });
});

describe("Gemini calls are handed over for recording", () => {
  it("hands over every attempt whole: the request as sent and the response or failure", async () => {
    fetchMock.mockImplementationOnce(async () => fail(503)).mockImplementation(async () => ok());
    await expect(run({ maxRetries: 1 })).resolves.toBe("A mug.");
    expect(recordCall).toHaveBeenCalledTimes(2);
    const [first, second] = recordCall.mock.calls.map(([call]) => call);
    const sent = {
      model: opts.model,
      contents: [
        { inlineData: { mimeType: "image/jpeg", data: request.imageBytes.toString("base64") } },
        { text: expect.stringContaining("Describe") }
      ],
      config: { thinkingConfig: { thinkingLevel: "MEDIUM" } }
    };
    expect(first).toMatchObject({ endpoint: "https://proxy.example/gemini", role: "description", model: opts.model, attempt: 1, request: sent, response: null });
    expect(first!.error).toMatchObject({ status: 503 });
    expect(second).toMatchObject({ attempt: 2, request: sent, error: null });
    expect(second!.response?.candidates?.[0]?.finishReason).toBe("STOP");
    expect(second!.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(second!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Gemini resend policy", () => {
  it.each([408, 429, 503])("resends %s up to the retry setting", async (status) => {
    fetchMock.mockImplementation(async () => fail(status));
    await expect(run({ maxRetries: 5 })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(6);
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
    vi.useFakeTimers();
    fetchMock.mockImplementation(stall);
    const work = run({ timeoutMs: 1000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("gives each attempt its own full timeout", async () => {
    vi.useFakeTimers();
    const startedAt: number[] = [];
    const abortedAt: number[] = [];
    fetchMock
      .mockImplementationOnce(() => { startedAt.push(Date.now()); return new Promise((resolve) => setTimeout(() => resolve(fail(503)), 800)); })
      .mockImplementation((url, init) => {
        startedAt.push(Date.now());
        init!.signal!.addEventListener("abort", () => abortedAt.push(Date.now()), { once: true });
        return stall(url, init);
      });
    const work = run({ timeoutMs: 1000 }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await work).toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(800);
    expect(abortedAt[0]! - startedAt[1]!).toBe(1000);
  });

  it.each(["SAFETY", "PROHIBITED_CONTENT"])("returns candidate refusal %s without retries", async (finishReason) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason }] })));
    const error = await run().catch((error) => error);
    expect(error).toMatchObject({ code: "safety-refusal" });
    expect(visionError(error, "description").retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
