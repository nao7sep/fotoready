import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiVisionProvider, VISION_ATTEMPTS, type GeminiCall, type GeminiCallLifecycle } from "@adapters/gemini";
import { SUPPORTED_MODELS } from "@shared/ai-models";
import { visionError } from "@main/queues/vision";

// Native promise timers keep their own timer reference, outside Vitest's fake clock. Retry timing
// cases use the same fake clock as the SDK; real-clock cancellation cases keep the native timer.
const retryWait = vi.hoisted(() => ({ entered: null as (() => void) | null }));
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:timers/promises")>();
  return { ...original, setTimeout: (ms: number, value: undefined, options: { signal?: AbortSignal }) => {
    if (vi.isFakeTimers()) return new Promise((resolve) => setTimeout(resolve, ms, value));
    const waiting = original.setTimeout(ms, value, options);
    retryWait.entered?.();
    return waiting;
  } };
});

const fetchMock = vi.fn<typeof fetch>();
const key = "test-provider-key";
const opts = { model: "gemini-3.8-flash", thinking: "medium" as string | null, mediaResolution: "high" as string | null, descriptionPrompt: "Describe", timeoutMs: 60000 };
const request = { imageBytes: Buffer.from("image"), mimeType: "image/jpeg" as const, width: 1024, height: 768, sourcePath: "/out/harbor-k3Jq9xZa.jpg" };
/** What a record keeps of the image sent: a summary, never the bytes, which would grow the records by a photo per call. */
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
      config: {},
      _diagnostics: { attemptId: expect.any(String) }
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
      _diagnostics: { attemptId: expect.any(String) },
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { slugs: { type: "ARRAY", minItems: "3", maxItems: "5", items: { type: "STRING" } } }, required: ["slugs"] }
      }
    });
    expect(sentBody()).not.toHaveProperty("safetySettings");
  });
});

describe("Gemini calls are handed over for recording", () => {
  it("records a sanitized start before an unsettled request and correlates its settlement", async () => {
    let resolve!: (response: Response) => void;
    let sent!: () => void;
    const sending = new Promise<void>((done) => { sent = done; });
    fetchMock.mockImplementation(() => { sent(); return new Promise<Response>((done) => { resolve = done; }); });
    const lifecycle = vi.fn<(event: GeminiCallLifecycle) => void>();
    const controller = new AbortController();
    const work = new GeminiVisionProvider(key, `https://proxy.example/${key}`, recordCall, lifecycle)
      .describeImage({ ...request, sourcePath: `/out/${key}.jpg` }, { ...opts, signal: controller.signal, descriptionPrompt: `Describe ${key}` });
    await sending;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordCall).not.toHaveBeenCalled();
    expect(lifecycle).toHaveBeenCalledOnce();
    const start = lifecycle.mock.calls[0]![0];
    expect(start).toMatchObject({ phase: "start", outcome: "unknown", role: "description", attempt: 1,
      request: { contents: [{ inlineData: { data: { ...sentImage, sourcePath: "/out/[REDACTED].jpg" } } }, { text: "Describe [REDACTED]\n\nReturn one sentence only. Do not use bullet points or JSON." }] } });
    expect(JSON.stringify(start)).not.toContain(key);
    expect(JSON.stringify(start)).not.toContain(request.imageBytes.toString("base64"));
    controller.abort();
    await Promise.resolve();
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(lifecycle.mock.calls[0]![0].outcome).toBe("unknown");
    expect(recordCall).not.toHaveBeenCalled();
    resolve(ok());
    await work;
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(recordCall).toHaveBeenCalledOnce();
    expect(recordCall.mock.calls[0]![0]).toMatchObject({ time: start.time, role: start.role, attempt: start.attempt, error: null, request: { _diagnostics: { attemptId: start.attemptId } } });
    expect(recordCall.mock.calls[0]![0].response).not.toBeNull();
    expect(sentBody()).not.toHaveProperty("_diagnostics");
  });

  it("records a known error only when the SDK settles", async () => {
    const lifecycle = vi.fn<(event: GeminiCallLifecycle) => void>();
    fetchMock.mockResolvedValue(fail(400));
    await expect(new GeminiVisionProvider(key, "https://proxy.example", recordCall, lifecycle).describeImage(request, opts)).rejects.toMatchObject({ status: 400 });
    expect(lifecycle.mock.calls.map(([event]) => [event.phase, event.outcome])).toEqual([["start", "unknown"]]);
    expect(recordCall).toHaveBeenCalledOnce();
    expect(recordCall.mock.calls[0]![0]).toMatchObject({ error: { status: 400 }, request: { _diagnostics: { attemptId: lifecycle.mock.calls[0]![0].attemptId } } });
  });
  it("records a summary of the image sent while Gemini still receives the image itself", async () => {
    fetchMock.mockImplementation(async () => ok());
    await run();
    expect(sentBody().contents[0].parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: request.imageBytes.toString("base64") });
    const recorded = JSON.stringify(recordCall.mock.calls[0]![0].request);
    expect(recorded).toContain(sentImage.sha256);
    expect(recorded).not.toContain(request.imageBytes.toString("base64"));
  });

  it("hands over every attempt whole: the request as sent and the response or failure", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(async () => fail(503)).mockImplementation(async () => ok());
    const lifecycle = vi.fn<(event: GeminiCallLifecycle) => void>();
    const work = new GeminiVisionProvider(key, "https://proxy.example/gemini", recordCall, lifecycle).describeImage(request, opts);
    await vi.runAllTimersAsync();
    await expect(work).resolves.toBe("A mug.");
    expect(recordCall).toHaveBeenCalledTimes(2);
    expect(lifecycle).toHaveBeenCalledTimes(2);
    const starts = lifecycle.mock.calls.map(([event]) => event);
    expect(starts.map((event) => [event.phase, event.outcome, event.attempt])).toEqual([["start", "unknown", 1], ["start", "unknown", 2]]);
    expect(new Set(starts.map((event) => event.attemptId)).size).toBe(2);
    for (const [index, [call]] of recordCall.mock.calls.entries()) {
      expect(call.request).toMatchObject({ _diagnostics: { attemptId: starts[index]!.attemptId } });
    }
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
  it("cancels a native retry wait without sending another request", async () => {
    fetchMock.mockResolvedValue(fail(503));
    const waiting = new Promise<void>((done) => { retryWait.entered = done; });
    const controller = new AbortController();
    const work = run({ signal: controller.signal }).catch((error: unknown) => error);
    await waiting;
    retryWait.entered = null;
    controller.abort();
    expect(await work).toMatchObject({ name: "AbortError", cause: controller.signal.reason });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not abort or release an issued request when future attempts are cancelled", async () => {
    let resolve!: (response: Response) => void;
    let sent!: () => void;
    const sending = new Promise<void>((done) => { sent = done; });
    fetchMock.mockImplementation(() => { sent(); return new Promise<Response>((done) => { resolve = done; }); });
    const controller = new AbortController();
    let settled = false;
    const work = run({ signal: controller.signal }).finally(() => { settled = true; });
    await sending;
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    resolve(ok());
    await expect(work).resolves.toBe("A mug.");
  });

  it("does not send an attempt when cancellation has already been requested", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run({ signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([408, 429, 503])("resends %s up to the attempt cap", async (status) => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => fail(status));
    const work = run().catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await work).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(VISION_ATTEMPTS);
  });

  it.each([400, 404, 500, 502, 504])("returns %s to the waiting user without resending", async (status) => {
    fetchMock.mockImplementation(async () => fail(status));
    await expect(run()).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])("retries the unsent connection failure %s", async (code) => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code } })).mockImplementation(async () => ok());
    const work = run();
    await vi.runAllTimersAsync();
    await expect(work).resolves.toBe("A mug.");
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

describe("Gemini slug response validation", () => {
  it.each([null, [], { slugs: [] }, { slugs: ["", " ", "!!!"] }, { slugs: ["valid", 42] }, { slugs: [null] }, { slugs: [{}] }])("rejects malformed or unusable slugs: %j", async (value) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] })));
    await expect(new GeminiVisionProvider(key, "https://proxy.example", recordCall).suggestSlugs("A mug", { ...opts, slugPrompt: "Slugs" })).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
