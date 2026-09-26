import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
