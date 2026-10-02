export type AiProvider = "gemini";
export type AiKind = "text-smart" | "text-balanced" | "text-fast" | "vision";

export type SupportedModel = {
  provider: AiProvider;
  id: string;
  kinds: readonly AiKind[];
  defaultFor: readonly AiKind[];
  thinking: readonly string[];
};

export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: "gemini", id: "gemini-3.1-pro-preview", kinds: ["text-smart"], defaultFor: ["text-smart"], thinking: ["low", "medium", "high"] },
  { provider: "gemini", id: "gemini-3.8-flash", kinds: ["text-balanced", "vision"], defaultFor: ["text-balanced", "vision"], thinking: ["low", "medium", "high"] },
  { provider: "gemini", id: "gemini-3.5-flash-lite", kinds: ["text-fast"], defaultFor: ["text-fast"], thinking: ["minimal", "low", "medium", "high"] }
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

/** The Thinking value a role starts at for a model (ai-model-routing-conventions, Thinking); null when the id has no row. */
export function defaultThinkingFor(provider: AiProvider, kind: AiKind, id: string): string | null {
  const values = supportedModel(provider, id)?.thinking ?? [];
  if (values.length === 0) return null;
  const preferred = kind === "text-fast" ? ["off", "none"] : ["adaptive", "medium"];
  return preferred.find((value) => values.includes(value)) ?? values[0]!;
}
