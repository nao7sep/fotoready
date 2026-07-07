import { GoogleGenAI, Type } from "@google/genai";
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
  constructor(private readonly apiKey: string) {}

  async describeImage(request: VisionDescribeRequest, opts: VisionDescribeOptions): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await callWithRetry(opts, () =>
      ai.models.generateContent({
        model: opts.model,
        contents: [
          { inlineData: { mimeType: request.mimeType, data: request.imageBytes.toString("base64") } },
          { text: descriptionPrompt(opts.descriptionPrompt) }
        ],
        config: { httpOptions: { timeout: opts.timeoutMs, retryOptions: { attempts: 1 } } }
      })
    );
    return parseDescription(response.text ?? "");
  }

  async suggestSlugs(description: string, opts: VisionSlugOptions): Promise<string[]> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await callWithRetry(opts, () =>
      ai.models.generateContent({
        model: opts.model,
        contents: [{ text: slugPrompt(description, opts.slugPrompt) }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SLUG_RESPONSE_SCHEMA,
          httpOptions: { timeout: opts.timeoutMs, retryOptions: { attempts: 1 } }
        }
      })
    );
    return parseSlugs(response.text ?? "");
  }
}

async function callWithRetry<T>(opts: VisionCallOptions, fn: () => Promise<T>): Promise<T> {
  const attempts = Math.max(1, opts.maxRetries + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) {
        throw error;
      }
      const delay = backoffDelayMs(opts.initialBackoffMs, attempt, retryAfterMs(error));
      await sleep(delay);
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  const status = readErrorStatus(error);
  if (status === 429) return true;
  if (status !== null && status >= 500) return true;
  if (status === 401 || status === 403) return false;
  const message = readErrorMessage(error).toLowerCase();
  if (/\btimeout\b|\btimed out\b|\bnetwork\b|\bfetch failed\b|\bconnection\b|\bsocket\b|\beconn|\babort/.test(message)) return true;
  if (/\bsafety\b|\bcontent policy\b|\bpolicy\b|\bblocked\b|\bprohibited\b|\bdisallow/.test(message)) return false;
  return false;
}

function backoffDelayMs(initial: number, attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null) return retryAfter;
  const base = initial * Math.pow(2, attempt);
  const jitter = Math.random() * initial;
  return Math.min(30000, base + jitter);
}

function retryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const headers = (error as { headers?: Record<string, string> }).headers;
  const value = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
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

function parseDescription(raw: string): string {
  const normalized = singleLine(raw, { minify: true });
  if (!normalized) {
    throw new Error("Vision provider returned an empty description response.");
  }
  return normalized;
}

function parseSlugs(raw: string): string[] {
  const parsed = JSON.parse(raw) as { slugs?: unknown };
  if (!Array.isArray(parsed.slugs)) {
    throw new Error("Vision provider returned an invalid slug response.");
  }
  return parsed.slugs.map((slug) => normalizeSlugCandidate(String(slug))).filter(Boolean).slice(0, 5);
}
