import { describe, expect, it } from "vitest";
import { loadCatalogue } from "@shared/i18n/catalogues";
import { LANGUAGES, languageNameIn } from "@shared/i18n/languages";
import { automaticWorkerPoolSize } from "@shared/worker-pool";

// A choice that follows something outside the app names what it resolves to now, in the interface
// language, as "Word (value)" (localization-conventions, Translation).
const RESOLVED_KEYS = [
  "settings.languageSystemResolved",
  "settings.themeSystemResolved",
  "settings.timeZoneSystem",
  "settings.defaultFolder",
  "settings.concurrentSavesAutomatic"
] as const;

describe("choices that name what they resolve to", () => {
  it("write the word and the value in brackets that follow each language's punctuation", async () => {
    // Japanese and Chinese use full-width brackets and Korean attaches them, all without a space;
    // the other languages write a space and plain parentheses.
    const forms: Partial<Record<string, RegExp>> = {
      ja: /^\S+（\{\w+\}）$/,
      "zh-Hans": /^\S+（\{\w+\}）$/,
      ko: /^\S+\(\{\w+\}\)$/
    };
    for (const language of LANGUAGES) {
      const catalogue = await loadCatalogue(language) as Record<string, unknown>;
      for (const key of RESOLVED_KEYS) {
        expect(catalogue[key], `${language} ${key}`).toMatch(forms[language] ?? /^\S.*\S \(\{\w+\}\)$/);
      }
    }
  });

  it("name the computer's language in the interface language", () => {
    expect(languageNameIn("en", "ja")).toBe("Japanese");
    expect(languageNameIn("ja", "ja")).toBe("日本語");
    expect(languageNameIn("de", "en")).toBe("Englisch");
  });

  it("show the worker count Automatic picks: one per core, at most eight", () => {
    expect(automaticWorkerPoolSize(4)).toBe(4);
    expect(automaticWorkerPoolSize(10)).toBe(8);
    expect(automaticWorkerPoolSize(0)).toBe(1);
  });
});
