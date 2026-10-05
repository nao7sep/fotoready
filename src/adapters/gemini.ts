import { ApiError, GoogleGenAI, HarmBlockThreshold, HarmCategory, PartMediaResolutionLevel, ThinkingLevel, Type, type GenerateContentConfig, type GenerateContentParameters, type GenerateContentResponse, type Part, type PartMediaResolution, type SafetySetting } from "@google/genai";
import { isRecord } from "@shared/validation/common";
import { normalizeSlugCandidate } from "@core/slug/rules";
import { singleLine } from "@shared/text-cleanup";
import { nowIso } from "@shared/time";

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
  thinking: string | null;
  mediaResolution: string | null;
  descriptionPrompt: string;
};

export type VisionSlugOptions = VisionCallOptions & {
  model: string;
  thinking: string | null;
  slugPrompt: string;
};

/** One request as sent to the SDK and what came back, for the caller to record. */
export type GeminiCall = {
  /** When the request was sent. */
  time: string;
  endpoint: string;
  role: "description" | "slug";
  model: string;
  /** 1 for the first send, counting each resend. */
  attempt: number;
  durationMs: number;
  request: GenerateContentParameters;
  response: GenerateContentResponse | null;
  error: unknown;
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

/**
 * Every request turns off each current safety category, the most permissive value Gemini takes,
 * and is never exposed (ai-model-lineup-20261004, Safety). Civic integrity is deprecated and not sent.
 */
export const SAFETY_SETTINGS: readonly SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_JAILBREAK
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

/**
 * What each supported model needs beyond the plain request, one branch per row of
 * SUPPORTED_MODELS; each branch translates the row's Thinking values. An id with no branch gets
 * nothing model-specific; whether it works is the provider's answer.
 */
export function modelConfig(id: string, thinking: string | null): GenerateContentConfig {
  switch (id.trim().toLowerCase()) {
    case "gemini-3.1-pro-preview":
      // Gemini 3.x takes thinkingLevel.
      return thinkingLevelConfig(thinking);
    case "gemini-3.8-flash":
      // Gemini 3.x takes thinkingLevel.
      return thinkingLevelConfig(thinking);
    case "gemini-3.5-flash-lite":
      // Gemini 3.x takes thinkingLevel.
      return thinkingLevelConfig(thinking);
    default:
      return {};
  }
}

const THINKING_LEVELS: Readonly<Record<string, ThinkingLevel>> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH
};

function thinkingLevelConfig(thinking: string | null): GenerateContentConfig {
  const thinkingLevel = thinking === null ? undefined : THINKING_LEVELS[thinking];
  return thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {};
}

/**
 * How each supported model reads an image part, one branch per row of SUPPORTED_MODELS; each
 * branch translates the row's mediaResolution levels. An id with no branch, or no level, sets none.
 */
export function imageMediaResolution(id: string, level: string | null): PartMediaResolution | undefined {
  switch (id.trim().toLowerCase()) {
    case "gemini-3.1-pro-preview":
    case "gemini-3.8-flash":
    case "gemini-3.5-flash-lite": {
      // Gemini 3 takes a level on the image part.
      const value = level === null ? undefined : MEDIA_RESOLUTION_LEVELS[level];
      return value ? { level: value } : undefined;
    }
    default:
      return undefined;
  }
}

const MEDIA_RESOLUTION_LEVELS: Readonly<Record<string, PartMediaResolutionLevel>> = {
  low: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW,
  medium: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
  ultra_high: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH
};

export class GeminiVisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly recordCall: (call: GeminiCall) => void
  ) {}

  async describeImage(request: VisionDescribeRequest, opts: VisionDescribeOptions): Promise<string> {
    const mediaResolution = imageMediaResolution(opts.model, opts.mediaResolution);
    const response = await this.generate("description", opts, [
      { inlineData: { mimeType: request.mimeType, data: request.imageBytes.toString("base64") }, ...(mediaResolution ? { mediaResolution } : {}) },
      { text: descriptionPrompt(opts.descriptionPrompt) }
    ]);
    assertUsableResponse(response, "image");
    return parseDescription(response.text ?? "");
  }

  async suggestSlugs(description: string, opts: VisionSlugOptions): Promise<string[]> {
    const response = await this.generate("slug", opts, [{ text: slugPrompt(description, opts.slugPrompt) }], {
      responseMimeType: "application/json",
      responseSchema: SLUG_RESPONSE_SCHEMA
    });
    assertUsableResponse(response, "description");
    return parseSlugs(response.text ?? "");
  }

  private async generate(
    role: GeminiCall["role"],
    opts: VisionCallOptions & { model: string; thinking: string | null },
    parts: Part[],
    featureConfig: GenerateContentConfig = {}
  ): Promise<GenerateContentResponse> {
    // The SDK's own retries are off; callWithRetry owns resending. The client's timeout bounds
    // each request, and a timed-out or otherwise unknown outcome is returned to the user, never resent.
    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { baseUrl: this.endpoint, timeout: opts.timeoutMs, retryOptions: { attempts: 1 } }
    });
    const request: GenerateContentParameters = {
      model: opts.model,
      contents: parts,
      config: { ...modelConfig(opts.model, opts.thinking), ...featureConfig, safetySettings: [...SAFETY_SETTINGS] }
    };
    return callWithRetry(opts, async (attempt) => {
      const time = nowIso();
      const startedAt = performance.now();
      const record = (response: GenerateContentResponse | null, error: unknown) => this.recordCall({
        time, endpoint: this.endpoint, role, model: opts.model, attempt,
        durationMs: performance.now() - startedAt, request, response, error
      });
      try {
        const response = await ai.models.generateContent(request);
        record(response, null);
        return response;
      } catch (error) {
        record(null, error);
        throw error;
      }
    });
  }
}

async function callWithRetry<T>(opts: VisionCallOptions, fn: (attempt: number) => Promise<T>): Promise<T> {
  const attempts = Math.max(1, opts.maxRetries + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt + 1);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) {
        throw error;
      }
      const delay = backoffDelayMs(opts.initialBackoffMs, attempt);
      await sleep(delay);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
