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

  it("holds the settings form's bounds: preview long edge from 320, debounce up to 2000 ms", () => {
    const below = normalizeGlobalSettings({ ...fallback, previewLongEdge: 319, previewDebounceMs: 2001 }, fallback);
    expect(below.issues).toHaveLength(2);
    const at = normalizeGlobalSettings({ ...fallback, previewLongEdge: 320, previewDebounceMs: 2000 }, fallback);
    expect(at.issues).toEqual([]);
    expect(at.settings).toMatchObject({ previewLongEdge: 320, previewDebounceMs: 2000 });
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

  it("preserves description selection independently of the slug set", () => {
    const { settings } = normalizeGlobalSettings(
      { ...fallback, defaultGenerateSlug: true, defaultGenerateDescription: false },
      fallback
    );
    expect(settings.defaultGenerateDescription).toBe(false);
  });

  it("preserves jpeg quality mode independently of the estimate set", () => {
    const { settings } = normalizeGlobalSettings(
      { ...fallback, enableJpegQualityEstimate: false, jpegQualityMode: "auto" },
      fallback
    );
    expect(settings.jpegQualityMode).toBe("auto");
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

  it("defaults the language to System and keeps each supported choice", () => {
    expect(fallback.language).toBe("system");
    for (const language of ["system", "en", "ja", "zh-Hans", "pt-BR"] as const) {
      const { settings, issues } = normalizeGlobalSettings({ ...fallback, language }, fallback);
      expect(settings.language).toBe(language);
      expect(issues).toEqual([]);
    }
  });

  it("reads a missing, retired, or hand-edited language as System without resetting the file", () => {
    const { language: _language, ...withoutLanguage } = { ...fallback, language: "de" };
    expect(normalizeGlobalSettings(withoutLanguage, fallback).settings.language).toBe("system");
    for (const language of ["zh-TW", "pt", "Deutsch", 7]) {
      const { settings, issues } = normalizeGlobalSettings({ ...fallback, language }, fallback);
      expect(settings.language).toBe("system");
      expect(issues).toHaveLength(1);
    }
  });

  it("defaults the theme to System and keeps each saved choice", () => {
    expect(fallback.theme).toBe("system");
    for (const theme of ["system", "light", "dark"] as const) {
      const { settings, issues } = normalizeGlobalSettings({ ...fallback, theme }, fallback);
      expect(settings.theme).toBe(theme);
      expect(issues).toEqual([]);
    }
  });

  it("resolves a missing theme to System and reports an unknown one", () => {
    const { theme: _theme, ...withoutTheme } = { ...fallback, theme: "dark" };
    const missing = normalizeGlobalSettings(withoutTheme, fallback);
    expect(missing.settings.theme).toBe("system");
    expect(missing.issues).toEqual([]);

    const unknown = normalizeGlobalSettings({ ...fallback, theme: "sepia" }, fallback);
    expect(unknown.settings.theme).toBe("system");
    expect(unknown.issues).toEqual(["settings.theme must be one of: system, light, dark."]);
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

describe("Open Gemini role model selections", () => {
  it("preserves a selection the shipped list no longer offers — kept verbatim, not snapped", () => {
    const { settings, issues } = normalizeGlobalSettings({ ...fallback, "gemini.description": "gemini-2.5-pro", "gemini.thinking.description": null, "gemini.mediaResolution.description": null }, fallback);
    expect(settings["gemini.description"]).toBe("gemini-2.5-pro");
    expect(issues).toEqual([]);
  });

  it("falls back to the shipped selection when model is blank or not a string, recording an issue", () => {
    const blank = normalizeGlobalSettings({ ...fallback, "gemini.description": "   " }, fallback);
    expect(blank.settings["gemini.description"]).toBe(fallback["gemini.description"]);
    expect(blank.issues.length).toBeGreaterThanOrEqual(1);

    const notString = normalizeGlobalSettings({ ...fallback, "gemini.description": 7 }, fallback);
    expect(notString.settings["gemini.description"]).toBe(fallback["gemini.description"]);
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
