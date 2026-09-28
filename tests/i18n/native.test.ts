import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../../src/shared/i18n/languages";

// What the packaged app declares outside the catalogues: the macOS bundle's
// localizations, which let AppKit draw its own menu items in the interface
// language, and the Windows installer's languages, English first as the
// fallback.

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  build: {
    mac: { extendInfo: { CFBundleLocalizations?: string[] } };
    nsis: { multiLanguageInstaller?: boolean; installerLanguages?: string[] };
  };
};

const INSTALLER_CODES: Record<(typeof LANGUAGES)[number], string> = {
  en: "en_US",
  de: "de_DE",
  es: "es_ES",
  fr: "fr_FR",
  it: "it_IT",
  "pt-BR": "pt_BR",
  ru: "ru_RU",
  ja: "ja_JP",
  ko: "ko_KR",
  "zh-Hans": "zh_CN",
};

describe("packaged language declarations", () => {
  it("declares exactly the interface languages in the macOS bundle", () => {
    expect([...(pkg.build.mac.extendInfo.CFBundleLocalizations ?? [])].sort()).toEqual([...LANGUAGES].sort());
  });

  it("builds the Windows installer in every interface language, English first", () => {
    const languages = [...(pkg.build.nsis.installerLanguages ?? [])];
    expect(languages[0]).toBe("en_US");
    expect(languages.sort()).toEqual(Object.values(INSTALLER_CODES).sort());
    expect(pkg.build.nsis.multiLanguageInstaller).toBe(true);
  });
});
