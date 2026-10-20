import { describe, expect, it } from "vitest";
import { AI_ROLES, SUPPORTED_MODELS, defaultMediaResolutionFor, defaultModelFor, defaultThinkingFor, modelsFor } from "@shared/ai-models";
import { defaultGlobalSettings, SETTINGS_KEYS } from "@shared/defaults";
import { SAFETY_SETTINGS, imageMediaResolution, modelConfig } from "@adapters/gemini";

// Checks the tables against the code that uses them: the request builder and the roles. The rows'
// own values come from the lineup research and are reviewed when the table changes.
describe("AI routing table guard", () => {
  it("gives every row a Thinking default it lists", () => {
    for (const row of SUPPORTED_MODELS) expect(row.thinking, row.id).toContain(row.defaultThinking);
  });

  it("has exactly one default per provider and kind, a row for every role, and a settings field for each role", () => {
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
    // Only the description role sends an image, so only it has an image resolution.
    expect(SETTINGS_KEYS.filter((key) => key.startsWith("gemini.mediaResolution."))).toEqual(["gemini.mediaResolution.description"]);
    expect(defaultGlobalSettings()["gemini.mediaResolution.description"]).toBe(defaultMediaResolutionFor("gemini", defaultModelFor("gemini", "vision")));
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
    const id = SUPPORTED_MODELS[0]!.id;
    expect(imageMediaResolution(id, null)).toBeUndefined();
    expect(imageMediaResolution(` ${id.toUpperCase()} `, "low")).toEqual(imageMediaResolution(id, "low"));
  });

  it("starts the image resolution at High, and an id with no row at none", () => {
    for (const row of SUPPORTED_MODELS.filter((candidate) => candidate.mediaResolution.length > 1)) {
      expect(defaultMediaResolutionFor(row.provider, row.id), row.id).toBe("high");
    }
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
    const id = SUPPORTED_MODELS[0]!.id;
    expect(modelConfig(` ${id.toUpperCase()} `, "low")).toEqual(modelConfig(id, "low"));
  });

  it("starts Thinking at the chosen model's own default, whatever the role, and an id with no row at none", () => {
    for (const row of SUPPORTED_MODELS) {
      expect(defaultThinkingFor(row.provider, row.id), row.id).toBe(row.defaultThinking);
      expect(defaultThinkingFor(row.provider, ` ${row.id.toUpperCase()} `), row.id).toBe(row.defaultThinking);
    }
    expect(defaultThinkingFor("gemini", "typed-unknown")).toBeNull();
  });
});
