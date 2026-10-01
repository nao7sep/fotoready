import { ApiError, GoogleGenAI, Type, type GenerateContentResponse, type Part } from "@google/genai";
import { modelParameters } from "./gemini-model-registry";
import { isRecord } from "@shared/validation/common";
import { normalizeSlugCandidate } from "@core/slug/rules";
import { singleLine } from "@shared/text-cleanup";

export type VisionDescribeRequest = {
  imageBytes: Buffer;
  mimeType: "image/jpeg";
};

export type VisionCallOptions = {
  timeoutMs: number;
  maxRetries: number;
  initialBackoffMs: number;
};

export type VisionDescribeOptions = VisionCallOptions & {
  model: string;
  descriptionPrompt: string;
};

export type VisionSlugOptions = VisionCallOptions & {
  model: string;
  slugPrompt: string;
};

export type VisionProviderFailureCode =
  | "missing-api-key"
  | "safety-refusal"
  | "incomplete-response"
  | "invalid-response";

/** Stable provider outcomes used for retry and presentation without parsing diagnostics. */
export class VisionProviderFailure extends Error {
  constructor(readonly code: VisionProviderFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VisionProviderFailure";
  }
}

const SLUG_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    slugs: {
      type: Type.ARRAY,
      minItems: "3",
      maxItems: "5",
      items: { type: Type.STRING }
    }
  },
  required: ["slugs"]
} as const;

export class GeminiVisionProvider {
  constructor(private readonly apiKey: string, private readonly endpoint: string) {}

  async describeImage(request: VisionDescribeRequest, opts: VisionDescribeOptions): Promise<string> {
    const response = await this.generate(opts, [
      { inlineData: { mimeType: request.mimeType, data: request.imageBytes.toString("base64") } },
      { text: descriptionPrompt(opts.descriptionPrompt) }
    ], 1024);
    assertUsableResponse(response, "image");
    return parseDescription(response.text ?? "");
  }

  async suggestSlugs(description: string, opts: VisionSlugOptions): Promise<string[]> {
    const response = await this.generate(opts, [{ text: slugPrompt(description, opts.slugPrompt) }], 512, SLUG_RESPONSE_SCHEMA);
    assertUsableResponse(response, "description");
    return parseSlugs(response.text ?? "");
  }

  private async generate(opts: VisionCallOptions & { model: string }, parts: Part[], ceiling: number, schema?: typeof SLUG_RESPONSE_SCHEMA): Promise<GenerateContentResponse> {
    // The SDK's own retries are off; callWithRetry owns resending. The client's timeout bounds
    // one request, the signal spans every attempt and backoff, and an unknown outcome is
    // returned to the user, never resent.
    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { baseUrl: this.endpoint, timeout: opts.timeoutMs, retryOptions: { attempts: 1 } }
    });
    const signal = AbortSignal.timeout(opts.timeoutMs);
    return callWithRetry(opts, signal, () => ai.models.generateContent({
      model: opts.model,
      contents: parts,
      config: { ...modelParameters(opts.model, ceiling, schema), abortSignal: signal }
    }));
  }
}

async function callWithRetry<T>(opts: VisionCallOptions, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const attempts = Math.min(3, Math.max(1, opts.maxRetries + 1));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === attempts - 1 || !isRetryable(error)) {
        throw error;
      }
      const delay = backoffDelayMs(opts.initialBackoffMs, attempt);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return [408, 429, 503].includes(error.status);
  const cause = error instanceof Error ? error.cause : null;
  return isRecord(cause) && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(String(cause.code));
}

function backoffDelayMs(initial: number, attempt: number): number {
  const base = initial * Math.pow(2, attempt);
  const jitter = Math.random() * initial;
  return Math.min(30000, base + jitter);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function descriptionPrompt(prompt: string): string {
  return `${prompt.trim()}\n\nReturn one sentence only. Do not use bullet points or JSON.`;
}

function slugPrompt(description: string, prompt: string): string {
  return `${prompt.trim()}\n\nDescription: ${description}`;
}

/**
 * The provider's own account of a result that is not what was asked for, read BEFORE the text
 * (ai-model-routing-conventions: *never invent a cause the provider gave you*).
 *
 * Reading only `.text` turns a refusal into "returned an empty description response", which is
 * a statement about our parsing when the truth is that the image was rejected — the user can act
 * on the second and not the first. MAX_TOKENS is the quieter case: the text is there and reads
 * like a complete short description.
 */
function assertUsableResponse(response: { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string }[] }, what: string): void {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new VisionProviderFailure(
      "safety-refusal",
      `Gemini refused this ${what} (${blockReason}). The input was rejected, not lost.`,
    );
  }
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
    throw new VisionProviderFailure("safety-refusal", `Gemini refused this ${what} (${finishReason}).`);
  }
  if (finishReason === "MAX_TOKENS") {
    throw new VisionProviderFailure(
      "incomplete-response",
      `Gemini stopped at its output limit, so this ${what} is truncated rather than complete.`,
    );
  }
  if (finishReason && finishReason !== "STOP") {
    throw new VisionProviderFailure(
      "incomplete-response",
      `Gemini stopped early (${finishReason}), so this ${what} is incomplete.`,
    );
  }
}

function parseDescription(raw: string): string {
  const normalized = singleLine(raw, { minify: true });
  if (!normalized) {
    throw new VisionProviderFailure("invalid-response", "Vision provider returned an empty description response.");
  }
  return normalized;
}

function parseSlugs(raw: string): string[] {
  let parsed: { slugs?: unknown };
  try {
    parsed = JSON.parse(raw) as { slugs?: unknown };
  } catch (error) {
    throw new VisionProviderFailure("invalid-response", "Vision provider returned invalid JSON for slugs.", { cause: error });
  }
  if (!Array.isArray(parsed.slugs)) {
    throw new VisionProviderFailure("invalid-response", "Vision provider returned an invalid slug response.");
  }
  return parsed.slugs.map((slug) => normalizeSlugCandidate(String(slug))).filter(Boolean).slice(0, 5);
}
