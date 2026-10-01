import { describe, expect, it } from "vitest";
import { AI_ROLES, SUPPORTED_MODELS, defaultModelFor, modelsFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { modelConfig } from "@adapters/gemini";

describe("AI routing table guard", () => {
  it("pins the role kinds and defaults", () => {
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

  it("gives every supported row its own branch and an unknown id nothing model-specific", () => {
    const handled = SUPPORTED_MODELS.filter((row) => Object.keys(modelConfig(row.id)).length > 0).map((row) => row.id);
    expect(handled).toEqual(SUPPORTED_MODELS.map((row) => row.id));
    for (const row of SUPPORTED_MODELS) expect(modelConfig(row.id)).not.toHaveProperty("maxOutputTokens");
    expect(modelConfig("gemini-3.99-new")).toEqual({});
    expect(modelConfig("unrelated-model")).toEqual({});
    expect(modelConfig(" GEMINI-3.8-FLASH ")).toEqual(modelConfig("gemini-3.8-flash"));
  });
});
