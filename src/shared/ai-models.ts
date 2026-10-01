export type AiProvider = "gemini";
export type AiKind = "text-smart" | "text-balanced" | "text-fast" | "vision";

export type SupportedModel = {
  provider: AiProvider;
  id: string;
  kinds: readonly AiKind[];
  defaultFor: readonly AiKind[];
};

export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: "gemini", id: "gemini-3.1-pro-preview", kinds: ["text-smart"], defaultFor: ["text-smart"] },
  { provider: "gemini", id: "gemini-3.8-flash", kinds: ["text-balanced", "vision"], defaultFor: ["text-balanced", "vision"] },
  { provider: "gemini", id: "gemini-3.5-flash-lite", kinds: ["text-fast"], defaultFor: ["text-fast"] }
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
