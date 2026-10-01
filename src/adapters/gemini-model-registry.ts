import { ThinkingLevel, type GenerateContentConfig } from "@google/genai";

type ModelPolicy = {
  maxOutputTokens: boolean;
  jsonResponse: boolean;
  thinkingConfig?: { thinkingLevel: ThinkingLevel } | { thinkingBudget: number };
};

type ModelFamily = { adapter: "gemini.generateContent"; generic: boolean; policy: ModelPolicy };

export const MODEL_FAMILIES = {
  "gemini.3": {
    adapter: "gemini.generateContent", generic: false,
    policy: { maxOutputTokens: true, jsonResponse: true, thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } }
  },
  "gemini.2.5": {
    adapter: "gemini.generateContent", generic: false,
    policy: { maxOutputTokens: true, jsonResponse: true, thinkingConfig: { thinkingBudget: -1 } }
  },
  "gemini.other": {
    adapter: "gemini.generateContent", generic: false,
    policy: { maxOutputTokens: true, jsonResponse: true }
  },
  "gemini.generic": {
    adapter: "gemini.generateContent", generic: true,
    policy: { maxOutputTokens: true, jsonResponse: true }
  }
} as const satisfies Record<string, ModelFamily>;

export const MODEL_RULES = [
  { pattern: /^gemini-3/, family: "gemini.3" },
  { pattern: /^gemini-2\.5-/, family: "gemini.2.5" },
  { pattern: /^gemini-/, family: "gemini.other" }
] as const;

export const MODEL_EXCEPTIONS: Readonly<Record<string, Partial<ModelPolicy>>> = {};

export function resolveModel(id: string): ModelFamily & { family: keyof typeof MODEL_FAMILIES } {
  const family = MODEL_RULES.find((rule) => rule.pattern.test(id))?.family ?? "gemini.generic";
  const record = MODEL_FAMILIES[family];
  return { ...record, family, policy: { ...record.policy, ...MODEL_EXCEPTIONS[id] } };
}

/** Only parameters declared by the resolved family enter the provider request. */
export function modelParameters(id: string, maxOutputTokens: number, jsonSchema?: GenerateContentConfig["responseSchema"]): GenerateContentConfig {
  const { policy } = resolveModel(id);
  return {
    ...(policy.maxOutputTokens ? { maxOutputTokens } : {}),
    ...(policy.thinkingConfig ? { thinkingConfig: policy.thinkingConfig } : {}),
    ...(policy.jsonResponse && jsonSchema ? { responseMimeType: "application/json", responseSchema: jsonSchema } : {})
  };
}
