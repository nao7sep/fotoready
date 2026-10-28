import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGUAGES, type Language } from "@shared/i18n/languages";
import { APP_NAME } from "@shared/constants";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("app identity", () => {
  it("packages the app under the name it shows", () => {
    expect(packageJson.build.productName).toBe(APP_NAME);
  });
});

// The installer and the macOS bundle speak the app's interface languages
// (localization-conventions): English first, as the installer's fallback.
describe("interface languages outside the app", () => {
  it("builds the Windows installer in the interface languages", () => {
    // NSIS names a language by its locale; each interface language maps to one.
    const nsisFor: Record<Language, string> = {
      en: "en_US", de: "de_DE", es: "es_ES", fr: "fr_FR", it: "it_IT",
      "pt-BR": "pt_BR", ru: "ru_RU", ja: "ja_JP", ko: "ko_KR", "zh-Hans": "zh_CN",
    };
    expect(packageJson.build.nsis.installerLanguages).toEqual(LANGUAGES.map((language) => nsisFor[language]));
  });

  it("declares the interface languages as the macOS bundle's localizations", () => {
    expect(packageJson.build.mac.extendInfo.CFBundleLocalizations).toEqual([...LANGUAGES]);
  });

  it("keeps exactly the interface languages' localizations in the macOS bundle", () => {
    // Electron names its localizations with underscores and a region; each maps to one tag.
    const tagFor: Record<string, string> = { pt_BR: "pt-BR", zh_CN: "zh-Hans" };
    const tags = (packageJson.build.mac.electronLanguages as string[]).map((name) => tagFor[name] ?? name);
    expect(tags).toEqual([...LANGUAGES]);
  });
});

// exiftool-vendored spawns ExifTool from disk, which cannot happen inside app.asar: Perl scripts on
// macOS and Linux, its own executable on Windows.
describe("ExifTool in the packaged app", () => {
  it("keeps every platform's ExifTool delivery unpacked", () => {
    const unpacked = (file: string): boolean => packageJson.build.asarUnpack.some((glob: string) => path.matchesGlob(file, glob));
    expect(unpacked("node_modules/exiftool-vendored.pl/bin/exiftool")).toBe(true);
    expect(unpacked("node_modules/exiftool-vendored.pl/bin/lib/Image/ExifTool.pm")).toBe(true);
    expect(unpacked("node_modules/exiftool-vendored.exe/bin/exiftool.exe")).toBe(true);
    expect(unpacked("node_modules/exiftool-vendored/dist/ExifTool.js")).toBe(false);
  });
});
