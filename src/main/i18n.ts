/**
 * The interface language, as the main process holds it (localization-conventions).
 *
 * The main process draws text of its own — the application menu, native dialog titles and
 * filters, the startup notices, task errors and import reasons it composes — and tells the
 * renderer which language the window speaks, so both halves always agree. It reads the same
 * catalogues as the renderer (@shared/i18n).
 *
 * The computer's languages are read once, at launch; System resolves against that reading for
 * the whole session.
 */

import { app, systemPreferences } from "electron";
import {
  effectiveLanguage,
  formattingLocale,
  systemLanguage,
  type InterfaceLanguage,
  type Language,
  type LanguagePreference
} from "@shared/i18n/languages";
import { createTranslator, type Translator } from "@shared/i18n/translate";

// macOS draws some Edit menu items itself (Emoji & Symbols, Start Dictation, AutoFill, Writing
// Tools, Services) in the language AppKit settles on from AppleLanguages before any JavaScript
// runs. Electron offers no volatile argument domain, so the interface language is kept as
// AppleLanguages in the app's own defaults domain (never the global one), as macOS's per-app
// language setting does: AppKit and Chromium's own strings pick it up at the next launch. System
// removes the entry, so the computer's own list applies again. Only the packaged app does this: an
// unpackaged run shares the Electron runtime's own domain with every other app in development.
const APPLE_LANGUAGES = "AppleLanguages";

function ownsAppKitLanguages(): boolean {
  return process.platform === "darwin" && app.isPackaged;
}

/** What the app's own AppleLanguages entry should hold: the chosen language, or none for System. */
export function appKitLanguages(preference: LanguagePreference): string[] | null {
  return preference === "system" ? null : [preference];
}

let reportFailure: (message: string, error: unknown) => void = () => undefined;

/** Where a failure to align AppKit is reported; the log, once it exists. */
export function setLanguageFailureReporter(report: (message: string, error: unknown) => void): void {
  reportFailure = report;
}

function alignAppKit(preference: LanguagePreference): void {
  if (!ownsAppKitLanguages()) return;
  const languages = appKitLanguages(preference);
  try {
    if (languages === null) systemPreferences.removeUserDefault(APPLE_LANGUAGES);
    else systemPreferences.setUserDefault(APPLE_LANGUAGES, "array", languages);
  } catch (error) {
    reportFailure("could not align macOS's own menu items with the interface language", error);
  }
}

/** The computer's preferred languages, not the app's own entry, which would shadow them; the
 *  entry is written back when the saved choice is applied. */
function computerLanguages(): string[] {
  if (ownsAppKitLanguages()) systemPreferences.removeUserDefault(APPLE_LANGUAGES);
  return app.getPreferredSystemLanguages();
}

let computerLanguage: Language = "en";
let computerLocale: string | null = null;
let preference: LanguagePreference = "system";
let current: InterfaceLanguage = { language: "en", locale: "en" };
let translator: Translator = createTranslator("en");

function settle(next: LanguagePreference): boolean {
  preference = next;
  const language = effectiveLanguage(next, computerLanguage);
  const locale = formattingLocale(language, computerLocale);
  const changed = language !== current.language || locale !== current.locale;
  current = { language, locale };
  translator = createTranslator(language, locale);
  return changed;
}

/**
 * Reads the computer's languages and regional format. Runs once, when the app is ready and before
 * anything is drawn, so even a startup failure speaks the computer's language.
 */
export function detectComputerLanguage(): void {
  computerLanguage = systemLanguage(computerLanguages());
  computerLocale = app.getSystemLocale() || null;
  settle("system");
}

/** Applies the saved choice at launch; nothing is drawn yet. */
export function applyLanguagePreference(next: LanguagePreference): void {
  settle(next);
  alignAppKit(next);
}

/**
 * Applies a choice saved in Settings. Returns whether the interface language changed, so the
 * caller redraws what the main process draws and tells every window. macOS's own menu items
 * follow at the next launch, even when the choice leaves this session's language as it is.
 */
export function changeLanguagePreference(next: LanguagePreference): boolean {
  if (next === preference) return false;
  alignAppKit(next);
  return settle(next);
}

/** The language the window speaks and the locale it formats in. */
export function interfaceLanguage(): InterfaceLanguage {
  return current;
}

/** The translator for text the main process draws. */
export function mainTranslator(): Translator {
  return translator;
}
