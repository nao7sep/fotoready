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

describe("Gemini model list (config-seeding: owned, editable, current defaults)", () => {
  it("seeds a non-empty list whose default selection is a member of it", () => {
    expect(fallback.geminiModels.length).toBeGreaterThan(0);
    expect(fallback.geminiModels).toContain(fallback.model);
  });

  it("trims and de-duplicates the owned list", () => {
    const { settings, issues } = normalizeGlobalSettings(
      { ...fallback, geminiModels: ["  gemini-3.5-flash ", "gemini-2.5-pro", "gemini-3.5-flash"] },
      fallback
    );
    expect(settings.geminiModels).toEqual(["gemini-3.5-flash", "gemini-2.5-pro"]);
    expect(issues).toEqual([]);
  });

  it("preserves an out-of-list selection — an orphaned pick after a list edit is kept, not snapped or rejected", () => {
    // The store never checks membership; a bad or retired id surfaces when a vision job runs (fail-fast),
    // and the modal shows an out-of-list value as a fallback option so it is never silently lost.
    const { settings, issues } = normalizeGlobalSettings(
      { ...fallback, model: "gemini-2.5-pro", geminiModels: ["gemini-3.5-flash"] },
      fallback
    );
    expect(settings.model).toBe("gemini-2.5-pro");
    expect(settings.geminiModels).toEqual(["gemini-3.5-flash"]);
    expect(issues).toEqual([]);
  });

  it("reverts an empty list to the built-in defaults with an issue (lenient, never throws)", () => {
    const { settings, issues } = normalizeGlobalSettings({ ...fallback, geminiModels: [] }, fallback);
    expect(settings.geminiModels).toEqual(fallback.geminiModels);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it("reverts a non-array or non-string list to the built-in defaults with an issue", () => {
    const notArray = normalizeGlobalSettings({ ...fallback, geminiModels: "gemini-3.5-flash" }, fallback);
    expect(notArray.settings.geminiModels).toEqual(fallback.geminiModels);
    expect(notArray.issues.length).toBeGreaterThanOrEqual(1);

    const badEntry = normalizeGlobalSettings({ ...fallback, geminiModels: ["gemini-3.5-flash", 7] }, fallback);
    expect(badEntry.settings.geminiModels).toEqual(fallback.geminiModels);
    expect(badEntry.issues.length).toBeGreaterThanOrEqual(1);
  });
});
