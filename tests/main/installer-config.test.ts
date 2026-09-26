import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@shared/i18n/languages";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("Windows installer configuration", () => {
  it("uses the assisted dual-scope NSIS contract", () => {
    expect(packageJson.build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      runAfterFinish: true,
    });
  });
});

// The installer and the macOS bundle speak the app's interface languages
// (localization-conventions): English first, as the installer's fallback.
describe("interface languages outside the app", () => {
  it("builds the Windows installer in the ten interface languages", () => {
    expect(packageJson.build.nsis.installerLanguages).toEqual([
      "en_US", "de_DE", "es_ES", "fr_FR", "it_IT", "pt_BR", "ru_RU", "ja_JP", "ko_KR", "zh_CN",
    ]);
  });

  it("keeps exactly the interface languages' localizations in the macOS bundle", () => {
    // Electron names its localizations with underscores and a region; each maps to one tag.
    const tagFor: Record<string, string> = { pt_BR: "pt-BR", zh_CN: "zh-Hans" };
    const tags = (packageJson.build.mac.electronLanguages as string[]).map((name) => tagFor[name] ?? name);
    expect(tags).toEqual([...LANGUAGES]);
  });
});

describe("release artifact names", () => {
  // electron-builder's default names carry the arch; release names are fixed per the app-release-conventions.
  it("names each artifact <app>-<version> with only its fixed suffix", () => {
    const build = packageJson.build;
    expect(build.artifactName).toBeUndefined();
    expect(build.dmg.artifactName).toBe("${productName}-${version}.${ext}");
    expect(build.mac.artifactName).toBe("${productName}-${version}-mac.${ext}");
    expect(build.nsis.artifactName).toBe("${productName}-${version}-setup.${ext}");
    expect(build.win.artifactName).toBe("${productName}-${version}-win.${ext}");
  });
});

describe("packaged license texts", () => {
  it("ships the app, native-component, Electron, and Chromium licenses", () => {
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      { from: "LICENSE", to: "LICENSE.txt" },
      { from: "THIRD_PARTY_NOTICES", to: "THIRD_PARTY_NOTICES.txt" },
      { from: "node_modules/electron/dist/LICENSE", to: "electron/LICENSE" },
      {
        from: "node_modules/electron/dist/LICENSES.chromium.html",
        to: "electron/LICENSES.chromium.html",
      },
    ]));
  });

  it("prepares Electron before every package-script builder invocation", () => {
    for (const script of Object.values(packageJson.scripts) as string[]) {
      if (script.includes("electron-builder")) {
        expect(script.indexOf("npm run prepare:electron")).toBeLessThan(
          script.indexOf("electron-builder"),
        );
      }
    }
  });
});
