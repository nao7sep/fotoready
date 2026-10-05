export type AiProvider = "gemini";
export type AiKind = "text-smart" | "text-balanced" | "text-fast" | "vision";

export type SupportedModel = {
  provider: AiProvider;
  id: string;
  kinds: readonly AiKind[];
  defaultFor: readonly AiKind[];
  thinking: readonly string[];
  /** The Thinking value a role starts at with this model, set by the model's own tier (ai-model-routing-conventions, Thinking). */
  defaultThinking: string;
  /** The levels an image part may be read at, in the order the field lists them. */
  mediaResolution: readonly string[];
};

/** The lineup research document these rows and defaults come from. */
export const MODEL_LINEUP = "ai-model-lineup-20261004";

const GEMINI_3_MEDIA_RESOLUTION = ["low", "medium", "high", "ultra_high"] as const;

export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: "gemini", id: "gemini-3.1-pro-preview", kinds: ["text-smart", "vision"], defaultFor: ["text-smart"], thinking: ["low", "medium", "high"], defaultThinking: "medium", mediaResolution: GEMINI_3_MEDIA_RESOLUTION },
  { provider: "gemini", id: "gemini-3.8-flash", kinds: ["text-balanced", "vision"], defaultFor: ["text-balanced", "vision"], thinking: ["low", "medium", "high"], defaultThinking: "medium", mediaResolution: GEMINI_3_MEDIA_RESOLUTION },
  { provider: "gemini", id: "gemini-3.5-flash-lite", kinds: ["text-fast", "vision"], defaultFor: ["text-fast"], thinking: ["minimal", "low", "medium", "high"], defaultThinking: "minimal", mediaResolution: GEMINI_3_MEDIA_RESOLUTION }
];

export const AI_ROLES = [
  // One sentence about a photo from an inline JPEG needs image understanding.
  { id: "description", kind: "vision" },
  // Three to five slugs as JSON are short and formulaic.
  { id: "slug", kind: "text-fast" }
] as const satisfies readonly { id: string; kind: AiKind }[];

export function modelsFor(provider: AiProvider, kind: AiKind): readonly SupportedModel[] {
  return SUPPORTED_MODELS.filter((model) => model.provider === provider && model.kinds.includes(kind));
}

export function defaultModelFor(provider: AiProvider, kind: AiKind): string {
  const models = modelsFor(provider, kind);
  const model = models.find((row) => row.defaultFor.includes(kind)) ?? models[0];
  if (!model) throw new Error(`No model configured for ${provider} ${kind}.`);
  return model.id;
}

/** The row for a typed id, matched trimmed and case-insensitive; undefined when the id has no row. */
export function supportedModel(provider: AiProvider, id: string): SupportedModel | undefined {
  const key = id.trim().toLowerCase();
  return SUPPORTED_MODELS.find((row) => row.provider === provider && row.id === key);
}

/** The Thinking value a role starts at with a model, its row's own default whatever the role; null when the id has no row. */
export function defaultThinkingFor(provider: AiProvider, id: string): string | null {
  return supportedModel(provider, id)?.defaultThinking ?? null;
}

/**
 * The image resolution a model starts at: High, which Gemini also uses for a part that sets none;
 * null when the id has no row or its row offers no choice, which leaves the image part without one.
 */
export function defaultMediaResolutionFor(provider: AiProvider, id: string): string | null {
  const values = supportedModel(provider, id)?.mediaResolution ?? [];
  return values.length > 1 ? "high" : null;
}
