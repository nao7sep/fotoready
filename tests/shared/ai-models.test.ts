import { describe, expect, it } from "vitest";
import { AI_ROLES, MODEL_LINEUP, SUPPORTED_MODELS, defaultMediaResolutionFor, defaultModelFor, defaultThinkingFor, modelsFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { SAFETY_SETTINGS, imageMediaResolution, modelConfig } from "@adapters/gemini";

describe("AI routing table guard", () => {
  it("pins the lineup, every row in order, its lists and its defaults", () => {
    expect(MODEL_LINEUP).toBe("ai-model-lineup-20261004");
    const mediaResolution = ["low", "medium", "high", "ultra_high"];
    expect(SUPPORTED_MODELS).toEqual([
      { provider: "gemini", id: "gemini-3.1-pro-preview", kinds: ["text-smart", "vision"], defaultFor: ["text-smart"], thinking: ["low", "medium", "high"], defaultThinking: "medium", mediaResolution },
      { provider: "gemini", id: "gemini-3.8-flash", kinds: ["text-balanced", "vision"], defaultFor: ["text-balanced", "vision"], thinking: ["low", "medium", "high"], defaultThinking: "medium", mediaResolution },
      { provider: "gemini", id: "gemini-3.5-flash-lite", kinds: ["text-fast", "vision"], defaultFor: ["text-fast"], thinking: ["minimal", "low", "medium", "high"], defaultThinking: "minimal", mediaResolution }
    ]);
    // The description offers every tier, in table order.
    expect(modelsFor("gemini", "vision").map((row) => row.id)).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    for (const row of SUPPORTED_MODELS) expect(row.thinking, row.id).toContain(row.defaultThinking);
  });

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
        const thinkingKey = `${provider}.thinking.${role.id}` as const;
        expect(SETTINGS_KEYS).toContain(key);
        expect(SETTINGS_KEYS).toContain(thinkingKey);
        expect(defaultGlobalSettings()[key]).toBe(defaultModelFor(provider, role.kind));
        expect(defaultGlobalSettings()[thinkingKey]).toBe(defaultThinkingFor(provider, defaultModelFor(provider, role.kind)));
      }
    }
    expect(SETTINGS_KEYS).not.toContain("model");
    // Only the description role sends an image, so only it has an image resolution.
    expect(SETTINGS_KEYS.filter((key) => key.startsWith("gemini.mediaResolution."))).toEqual(["gemini.mediaResolution.description"]);
    expect(defaultGlobalSettings()["gemini.mediaResolution.description"]).toBe("high");
  });

  it("gives every supported row's image part its branch, which translates every image resolution the row lists", () => {
    for (const row of SUPPORTED_MODELS) {
      // High is the built-in, and what Gemini reads a part at that sets none.
      if (row.mediaResolution.length > 1) expect(row.mediaResolution, row.id).toContain("high");
      for (const value of row.mediaResolution) {
        expect(imageMediaResolution(row.id, value), `${row.id} ${value}`).toEqual({ level: `MEDIA_RESOLUTION_${value.toUpperCase()}` });
      }
    }
    expect(imageMediaResolution("gemini-3.99-new", "high")).toBeUndefined();
    expect(imageMediaResolution("gemini-3.8-flash", null)).toBeUndefined();
    expect(imageMediaResolution(" GEMINI-3.8-FLASH ", "low")).toEqual(imageMediaResolution("gemini-3.8-flash", "low"));
  });

  it("starts the image resolution at High, and an id with no row at none", () => {
    expect(defaultMediaResolutionFor("gemini", "gemini-3.8-flash")).toBe("high");
    expect(defaultMediaResolutionFor("gemini", "typed-unknown")).toBeNull();
  });

  it("gives every supported row its own branch, which sends its safety settings and translates every Thinking value the row lists", () => {
    for (const row of SUPPORTED_MODELS) {
      expect(row.thinking.length, row.id).toBeGreaterThan(0);
      for (const value of row.thinking) {
        expect(modelConfig(row.id, value), `${row.id} ${value}`).toEqual({ thinkingConfig: { thinkingLevel: value.toUpperCase() }, safetySettings: SAFETY_SETTINGS });
      }
    }
  });

  it("gives an unknown id nothing model-specific, safety settings included, and matches a row trimmed and case-insensitive", () => {
    expect(modelConfig("gemini-3.99-new", "medium")).toEqual({});
    expect(modelConfig("unrelated-model", null)).toEqual({});
    expect(modelConfig(" GEMINI-3.8-FLASH ", "low")).toEqual(modelConfig("gemini-3.8-flash", "low"));
  });

  it("starts Thinking at the chosen model's own default, whatever the role, and an id with no row at none", () => {
    expect(defaultThinkingFor("gemini", "gemini-3.1-pro-preview")).toBe("medium");
    expect(defaultThinkingFor("gemini", "gemini-3.8-flash")).toBe("medium");
    expect(defaultThinkingFor("gemini", "gemini-3.5-flash-lite")).toBe("minimal");
    expect(defaultThinkingFor("gemini", " GEMINI-3.5-FLASH-LITE ")).toBe("minimal");
    expect(defaultThinkingFor("gemini", "typed-unknown")).toBeNull();
    expect(defaultGlobalSettings()["gemini.thinking.description"]).toBe("medium");
    expect(defaultGlobalSettings()["gemini.thinking.slug"]).toBe("minimal");
  });
});
