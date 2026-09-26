import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  preferred: ["pl-PL", "de-AT", "en-US"],
  regional: "de-AT",
  defaults: new Map<string, unknown>(),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPreferredSystemLanguages: () => electron.preferred,
    getSystemLocale: () => electron.regional,
  },
  systemPreferences: {
    setUserDefault: (key: string, _type: string, value: unknown) => electron.defaults.set(key, value),
    removeUserDefault: (key: string) => electron.defaults.delete(key),
  },
}));

import {
  appKitLanguages,
  applyLanguagePreference,
  changeLanguagePreference,
  detectComputerLanguage,
  interfaceLanguage,
  mainTranslator,
} from "@main/i18n";

const onMac = process.platform === "darwin";

beforeEach(() => {
  electron.preferred = ["pl-PL", "de-AT", "en-US"];
  electron.defaults.clear();
  detectComputerLanguage();
  applyLanguagePreference("system");
});

describe("main-process interface language", () => {
  it("follows the computer's first supported language under System, in its regional format", () => {
    expect(interfaceLanguage()).toEqual({ language: "de", locale: "de-AT" });
    expect(mainTranslator().t("nativeMenu.edit")).toBe("Bearbeiten");
  });

  it("keeps a chosen language and reports whether a new choice changes the interface", () => {
    expect(changeLanguagePreference("ja")).toBe(true);
    expect(interfaceLanguage()).toEqual({ language: "ja", locale: "ja" });
    expect(mainTranslator().t("nativeMenu.edit")).toBe("編集");
    expect(changeLanguagePreference("ja")).toBe(false);
    expect(changeLanguagePreference("de")).toBe(true);
    // Choosing System when it speaks the same language changes nothing on screen.
    expect(changeLanguagePreference("system")).toBe(false);
  });

  it("reads the computer's languages at launch, not in the middle of a session", () => {
    electron.preferred = ["fr-FR"];
    changeLanguagePreference("ja");
    changeLanguagePreference("system");
    expect(interfaceLanguage().language).toBe("de");
  });
});

describe("macOS's own menu items", () => {
  it("holds the chosen language in the app's own AppleLanguages entry, and none for System", () => {
    expect(appKitLanguages("system")).toBeNull();
    expect(appKitLanguages("zh-Hans")).toEqual(["zh-Hans"]);
  });

  it.runIf(onMac)("writes the entry for a chosen language and removes it for System", () => {
    changeLanguagePreference("ko");
    expect(electron.defaults.get("AppleLanguages")).toEqual(["ko"]);
    changeLanguagePreference("system");
    expect(electron.defaults.has("AppleLanguages")).toBe(false);
  });

  it.runIf(onMac)("reads the computer's own list, not the entry an earlier launch wrote", () => {
    electron.defaults.set("AppleLanguages", ["ko"]);
    detectComputerLanguage();
    expect(electron.defaults.has("AppleLanguages")).toBe(false);
    applyLanguagePreference("ko");
    expect(electron.defaults.get("AppleLanguages")).toEqual(["ko"]);
  });
});
