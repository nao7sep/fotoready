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

/**
 * Dynamic thinking — the model decides how much to reason. Stated rather than left to the
 * provider's default, because the default is not one behaviour: measured live across the
 * shipped list, 3.1-pro-preview / 3.5-flash / 3-flash-preview all think unasked while
 * 3.1-flash-lite does not. Silence shipped four behaviours nobody chose, any of which the
 * provider could change without this app cutting a release; this ships one.
 *
 * `-1` and not `0`: disabling is NOT portable — gemini-3.1-pro-preview rejects it outright
 * ("Budget 0 is invalid. This model only works in thinking mode"), so a shipped `0` would
 * delete a model from the list by making it uncallable. Dynamic is accepted by every model
 * tested. Matches mumbler, which reached the same shape from the same measurement.
 *
 * This does NOT make the calls cheaper — dynamic is roughly what silence was already doing.
 * It is worth knowing that thinking is ~87% of the per-image bill (2026-07-16: ~1.4c/image
 * on 3.5-flash, of which ~1.2c is thinking, and the SLUG call reasons harder than the vision
 * call — ~1000-1200 tokens to emit three slugs). Capping the budget is the only lever that
 * would cut it, and it was declined deliberately: it risks the description quality this app
 * exists to produce, to save a cent. Revisit only if batches get large.
 */
const THINKING_CONFIG = { thinkingBudget: -1 } as const;

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
        config: {
          thinkingConfig: THINKING_CONFIG,
          httpOptions: { timeout: opts.timeoutMs, retryOptions: { attempts: 1 } }
        }
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
          thinkingConfig: THINKING_CONFIG,
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
