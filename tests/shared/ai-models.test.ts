import { describe, expect, it } from "vitest";
import { AI_ROLES, SUPPORTED_MODELS, defaultModelFor, modelsFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { MODEL_FAMILIES, MODEL_RULES, modelParameters, resolveModel } from "@adapters/gemini-model-registry";

describe("AI routing table guard", () => {
  it("pins the approved Gemini lineup, role kinds, and defaults", () => {
    expect(SUPPORTED_MODELS.map((model) => model.id)).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(AI_ROLES).toEqual([{ id: "description", kind: "vision" }, { id: "slug", kind: "text-fast" }]);
    expect(defaultModelFor("gemini", "vision")).toBe("gemini-3.8-flash");
    expect(defaultModelFor("gemini", "text-fast")).toBe("gemini-3.5-flash-lite");
    const providers = [...new Set(SUPPORTED_MODELS.map((row) => row.provider))];
    for (const provider of providers) {
      for (const kind of new Set(SUPPORTED_MODELS.flatMap((row) => row.kinds))) {
        expect(modelsFor(provider, kind).filter((row) => row.defaultFor.includes(kind))).toHaveLength(1);
      }
      for (const role of AI_ROLES) {
        expect(modelsFor(provider, role.kind).length).toBeGreaterThan(0);
        const key = `${provider}.${role.id}` as const;
        expect(SETTINGS_KEYS).toContain(key);
        expect(defaultGlobalSettings()[key]).toBe(defaultModelFor(provider, role.kind));
      }
    }
    expect(SETTINGS_KEYS).not.toContain("model");
  });

  it("resolves suggestions and future Gemini ids while leaving unknown ids generic", () => {
    for (const model of SUPPORTED_MODELS) expect(resolveModel(model.id).generic).toBe(false);
    expect(resolveModel("gemini-3.99-new").family).toBe("gemini.3");
    expect(resolveModel("gemini-2.5-flash").family).toBe("gemini.2.5");
    expect(resolveModel("gemini-4-future").family).toBe("gemini.other");
    expect(resolveModel("unrelated-model").generic).toBe(true);
  });

  it("builds only declared family parameters, including no thinking for generic ids", () => {
    const ids = [...MODEL_RULES.map((rule) => ({ "gemini.3": "gemini-3.8-flash", "gemini.2.5": "gemini-2.5-pro", "gemini.other": "gemini-4" })[rule.family]), "unknown"];
    for (const id of ids) {
      const resolved = resolveModel(id);
      const params = modelParameters(id, 1024, { type: "OBJECT" });
      expect(params).not.toHaveProperty("temperature");
      expect(params.maxOutputTokens).toBe(1024);
      expect(params.responseMimeType).toBe("application/json");
      if (resolved.policy.thinkingConfig) expect(params.thinkingConfig).toEqual(resolved.policy.thinkingConfig);
      else expect(params).not.toHaveProperty("thinkingConfig");
      expect(Object.keys(params).every((key) => ["maxOutputTokens", "responseMimeType", "responseSchema", ...(resolved.policy.thinkingConfig ? ["thinkingConfig"] : [])].includes(key))).toBe(true);
    }
    expect(Object.keys(MODEL_FAMILIES)).toHaveLength(4);
  });
});
