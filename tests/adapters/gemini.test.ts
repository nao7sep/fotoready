import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiVisionProvider, type GeminiCall } from "@adapters/gemini";
import { SUPPORTED_MODELS } from "@shared/ai-models";
import { visionError } from "@main/queues/vision";

const fetchMock = vi.fn<typeof fetch>();
const key = "test-provider-key";
const opts = { model: "gemini-3.8-flash", thinking: "medium" as string | null, mediaResolution: "high" as string | null, descriptionPrompt: "Describe", timeoutMs: 60000, maxRetries: 10, initialBackoffMs: 0 };
const request = { imageBytes: Buffer.from("image"), mimeType: "image/jpeg" as const, width: 1024, height: 768, sourcePath: "/out/harbor-k3Jq9xZa.jpg" };
/** What a record keeps of the image sent: a summary, never the bytes (an approved departure). */
const sentImage = {
  mimeType: "image/jpeg", width: 1024, height: 768, byteSize: 5,
  sha256: createHash("sha256").update(request.imageBytes).digest("hex"), sourcePath: "/out/harbor-k3Jq9xZa.jpg"
};
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

  // Every request says which level the image is read at, High included, though Gemini reads a part
  // that sets none at High too.
  it.each([
    ["high", "MEDIA_RESOLUTION_HIGH"],
    ["low", "MEDIA_RESOLUTION_LOW"]
  ])("sets the %s image resolution on the image part", async (mediaResolution, level) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ mediaResolution });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.contents[0].parts[0].mediaResolution).toEqual({ level });
    expect(body.contents[0].parts[1].mediaResolution).toBeUndefined();
  });

  it("sets no image resolution for an id with no branch", async () => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model: "typed-unknown", thinking: null, mediaResolution: null });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.contents[0].parts[0]).not.toHaveProperty("mediaResolution");
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

const SAFETY_OFF = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_JAILBREAK"]
  .map((category) => ({ category, threshold: "OFF" }));
const slugOk = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"slugs":["a-mug","cup","drink"]}' }] } }] }));
const slug = (model: string, thinking: string | null) => new GeminiVisionProvider(key, "https://models.example", recordCall).suggestSlugs("A mug", { ...opts, model, thinking, slugPrompt: "Slugs" });
const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

describe("Gemini requests send every choice as chosen", () => {
  const thinkingCases = SUPPORTED_MODELS.flatMap((row) => row.thinking.map((value) => [row.id, value] as const));
  const resolutionCases = SUPPORTED_MODELS.flatMap((row) => row.mediaResolution.map((value) => [row.id, value] as const));

  it.each(thinkingCases)("sends %s's description Thinking %s as its level, the model's default included", async (model, thinking) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model, thinking });
    expect(sentBody().generationConfig).toEqual({ thinkingConfig: { thinkingLevel: thinking.toUpperCase() } });
  });

  it.each(thinkingCases)("sends %s's slug Thinking %s as its level beside the strict slug schema", async (model, thinking) => {
    fetchMock.mockImplementation(async () => slugOk());
    await slug(model, thinking);
    expect(sentBody().generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { slugs: { type: "ARRAY", minItems: "3", maxItems: "5", items: { type: "STRING" } } }, required: ["slugs"] },
      thinkingConfig: { thinkingLevel: thinking.toUpperCase() }
    });
  });

  it.each(resolutionCases)("sends %s's image resolution %s on the image part, High included", async (model, mediaResolution) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model, mediaResolution });
    expect(sentBody().contents[0].parts[0].mediaResolution).toEqual({ level: `MEDIA_RESOLUTION_${mediaResolution.toUpperCase()}` });
  });

  it.each(SUPPORTED_MODELS.map((row) => row.id))("turns every current safety category off on the %s description and slug requests", async (model) => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model });
    expect(sentBody().safetySettings).toEqual(SAFETY_OFF);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => slugOk());
    await slug(model, null);
    expect(sentBody().safetySettings).toEqual(SAFETY_OFF);
  });
});

describe("Gemini requests for an id with no row are plain", () => {
  // A stored Thinking or image resolution kept while the id has no row is not sent.
  it("sends the description request with only the model, the image and the prompt", async () => {
    fetchMock.mockImplementation(async () => ok());
    await run({ model: "typed-unknown", thinking: "high", mediaResolution: "low" });
    expect(recordCall.mock.calls[0]![0].request).toEqual({
      model: "typed-unknown",
      contents: [
        { inlineData: { mimeType: "image/jpeg", data: sentImage } },
        { text: "Describe\n\nReturn one sentence only. Do not use bullet points or JSON." }
      ],
      config: {}
    });
    expect(sentBody()).not.toHaveProperty("safetySettings");
    expect(sentBody().generationConfig ?? {}).toEqual({});
  });

  it("sends the slug request with only the model, the prompt and the strict slug schema", async () => {
    fetchMock.mockImplementation(async () => slugOk());
    await slug("typed-unknown", "high");
    expect(recordCall.mock.calls[0]![0].request).toEqual({
      model: "typed-unknown",
      contents: [{ text: "Slugs\n\nDescription: A mug" }],
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { slugs: { type: "ARRAY", minItems: "3", maxItems: "5", items: { type: "STRING" } } }, required: ["slugs"] }
      }
    });
    expect(sentBody()).not.toHaveProperty("safetySettings");
  });
});

describe("Gemini calls are handed over for recording", () => {
  it("records a summary of the image sent while Gemini still receives the image itself", async () => {
    fetchMock.mockImplementation(async () => ok());
    await run();
    expect(sentBody().contents[0].parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: request.imageBytes.toString("base64") });
    const recorded = JSON.stringify(recordCall.mock.calls[0]![0].request);
    expect(recorded).toContain(sentImage.sha256);
    expect(recorded).not.toContain(request.imageBytes.toString("base64"));
  });

  it("hands over every attempt whole: the request as sent and the response or failure", async () => {
    fetchMock.mockImplementationOnce(async () => fail(503)).mockImplementation(async () => ok());
    await expect(run({ maxRetries: 1 })).resolves.toBe("A mug.");
    expect(recordCall).toHaveBeenCalledTimes(2);
    const [first, second] = recordCall.mock.calls.map(([call]) => call);
    const sent = {
      model: opts.model,
      contents: [
        { inlineData: { mimeType: "image/jpeg", data: sentImage } },
        { text: expect.stringContaining("Describe") }
      ],
      config: { thinkingConfig: { thinkingLevel: "MEDIUM" }, safetySettings: SAFETY_OFF }
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
