import { describe, expect, it } from "vitest";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { defaultGlobalSettings } from "@shared/defaults";

const fallback = defaultGlobalSettings();

describe("normalizeGlobalSettings", () => {
  it("returns a clean copy with no issues for a fully valid input", () => {
    const { settings, issues } = normalizeGlobalSettings(fallback, fallback);
    expect(issues).toEqual([]);
    expect(settings).toEqual(fallback);
    expect(settings).not.toBe(fallback);
  });

  it("treats a non-object input as one issue and uses the fallback", () => {
    const { settings, issues } = normalizeGlobalSettings(null, fallback);
    expect(issues).toContain("settings must be a JSON object.");
    expect(settings.previewLongEdge).toBe(fallback.previewLongEdge);
  });

  it("falls back per-key on a bad value and records an issue (lenient, never throws)", () => {
    const { settings, issues } = normalizeGlobalSettings(
      { ...fallback, webpMethod: 99, defaultBackgroundForTransparency: "" },
      fallback
    );
    expect(settings.webpMethod).toBe(fallback.webpMethod);
    expect(settings.defaultBackgroundForTransparency).toBe(fallback.defaultBackgroundForTransparency);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("uses the fallback for missing keys without recording an issue", () => {
    const { settings, issues } = normalizeGlobalSettings({}, fallback);
    expect(issues).toEqual([]);
    expect(settings).toEqual(fallback);
  });

  it("forces description generation on when slug generation is on", () => {
    const { settings } = normalizeGlobalSettings(
      { ...fallback, defaultGenerateSlug: true, defaultGenerateDescription: false },
      fallback
    );
    expect(settings.defaultGenerateDescription).toBe(true);
  });

  it("downgrades jpeg quality mode to fixed when the estimate is disabled", () => {
    const { settings } = normalizeGlobalSettings(
      { ...fallback, enableJpegQualityEstimate: false, jpegQualityMode: "auto" },
      fallback
    );
    expect(settings.jpegQualityMode).toBe("fixed");
  });

  it("accepts a null worker pool size", () => {
    const { settings, issues } = normalizeGlobalSettings({ ...fallback, workerPoolSize: null }, fallback);
    expect(settings.workerPoolSize).toBeNull();
    expect(issues).toEqual([]);
  });

  it("keeps known editable metadata fields and drops unknown keys", () => {
    const { settings, issues } = normalizeGlobalSettings(
      { ...fallback, injectFields: { author: "Jane", bogus: "x" } },
      fallback
    );
    expect(settings.injectFields.author).toBe("Jane");
    expect((settings.injectFields as Record<string, unknown>).bogus).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("defaults the UI font to blank (meaning the built-in default stack)", () => {
    expect(fallback.uiFontFamily).toBe("");
  });

  it("keeps a custom UI font and accepts a blank one", () => {
    const custom = normalizeGlobalSettings({ ...fallback, uiFontFamily: "Iosevka, monospace" }, fallback);
    expect(custom.settings.uiFontFamily).toBe("Iosevka, monospace");
    expect(custom.issues).toEqual([]);

    const blank = normalizeGlobalSettings({ ...fallback, uiFontFamily: "" }, fallback);
    expect(blank.settings.uiFontFamily).toBe("");
    expect(blank.issues).toEqual([]);
  });

  it("falls back the UI font when it is not a string", () => {
    const { settings, issues } = normalizeGlobalSettings({ ...fallback, uiFontFamily: 42 }, fallback);
    expect(settings.uiFontFamily).toBe(fallback.uiFontFamily);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back the whole injectFields object when a known field is a non-string", () => {
    const withFields = { ...fallback, injectFields: { author: "Jane" } };
    const { settings, issues } = normalizeGlobalSettings(
      { ...withFields, injectFields: { author: "Jane", credit: 5 } },
      withFields
    );
    // The parse throws on `credit: 5`, so injectFields reverts to the fallback object.
    expect(settings.injectFields).toEqual(withFields.injectFields);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Gemini model selection (closed list — the config stores the pick, never the list)", () => {
  // NOT tested here: that DEFAULT_GEMINI_MODEL is a member of GEMINI_MODELS. It is typed as
  // GeminiModel, so a non-member fails to compile — a runtime assertion could not fail and would
  // be exactly the vacuous test pixelup was carrying.

  it("preserves a selection the shipped list no longer offers — kept verbatim, not snapped", () => {
    // The load-bearing case for closing the list: a config written when the list was editable can
    // name any id. Snapping it to a valid one would be the store judging a selection it does not
    // own — pixelup's clamp handed a user the crash value doing exactly that. The id survives, the
    // Model picker shows it as no longer offered, and the vision job is what refuses it.
    const { settings, issues } = normalizeGlobalSettings({ ...fallback, model: "gemini-2.5-pro" }, fallback);
    expect(settings.model).toBe("gemini-2.5-pro");
    expect(issues).toEqual([]);
  });

  it("falls back to the shipped selection when model is blank or not a string, recording an issue", () => {
    const blank = normalizeGlobalSettings({ ...fallback, model: "   " }, fallback);
    expect(blank.settings.model).toBe(fallback.model);
    expect(blank.issues.length).toBeGreaterThanOrEqual(1);

    const notString = normalizeGlobalSettings({ ...fallback, model: 7 }, fallback);
    expect(notString.settings.model).toBe(fallback.model);
    expect(notString.issues.length).toBeGreaterThanOrEqual(1);
  });

  it("does not carry a geminiModels list into the normalized settings", () => {
    // A config from a build that owned an editable list still has the key. It must not survive
    // normalization: the list has one home now, and a second copy in the config would be a second
    // writer of the same thing.
    const { settings } = normalizeGlobalSettings({ ...fallback, geminiModels: ["gemini-2.5-pro"] }, fallback);
    expect(settings).not.toHaveProperty("geminiModels");
  });
});
