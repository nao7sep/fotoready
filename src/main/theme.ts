import { BrowserWindow, nativeTheme, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import type { ThemePreference } from "@shared/types/settings";

// Electron's nativeTheme.themeSource is FotoReady's one theme authority (app-chrome conventions,
// Theme): it paints the native title bar, menus, and dialogs, and it decides `prefers-color-scheme`
// in every renderer, which is what app.css's dark block and the plain message dialog follow. No
// renderer resolves System itself.

// app.css's --app-bg in each theme, so the frames before a page paints and the backing exposed
// while resizing already match it.
const LIGHT_BACKGROUND = "#f5f5f4";
const DARK_BACKGROUND = "#161616";

export function windowBackground(dark: boolean = nativeTheme.shouldUseDarkColors): string {
  return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function syncWindowBackgrounds(): void {
  const color = windowBackground();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setBackgroundColor(color);
  }
}

/** Applies a saved choice to the whole app; System follows the OS. */
export function applyThemePreference(preference: ThemePreference): void {
  nativeTheme.themeSource = preference;
  syncWindowBackgrounds();
}

/** Keeps window backgrounds in step when the OS appearance changes under System. */
export function followOsThemeChanges(): void {
  nativeTheme.on("updated", syncWindowBackgrounds);
}

export type Appearance = "light" | "dark";

/**
 * What System resolves to now, for the Settings label "System (Dark)" (app-chrome conventions,
 * Theme). While FotoReady forces Light or Dark, nativeTheme reports the forced theme, so the OS
 * setting is read directly: macOS's interface style, or Windows's app mode. Elsewhere, or when that
 * read fails, it falls back to what nativeTheme reports.
 */
export async function osAppearance(read: AppearanceReads = electronAppearanceReads): Promise<Appearance> {
  if (read.themeSource() === "system") return read.nativeDark() ? "dark" : "light";
  try {
    if (read.platform === "darwin") return read.macInterfaceStyle() === "Dark" ? "dark" : "light";
    if (read.platform === "win32") return windowsAppearance(await read.windowsPersonalize());
  } catch {
    // The label is a convenience; the fallback below is the best remaining answer.
  }
  return read.nativeDark() ? "dark" : "light";
}

export type AppearanceReads = {
  platform: NodeJS.Platform;
  themeSource(): string;
  nativeDark(): boolean;
  macInterfaceStyle(): string;
  windowsPersonalize(): Promise<string>;
};

const electronAppearanceReads: AppearanceReads = {
  platform: process.platform,
  themeSource: () => nativeTheme.themeSource,
  nativeDark: () => nativeTheme.shouldUseDarkColors,
  // Set to "Dark" only while macOS is dark, Auto included.
  macInterfaceStyle: () => systemPreferences.getUserDefault("AppleInterfaceStyle", "string"),
  windowsPersonalize: () => new Promise((resolve, reject) => {
    execFile("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
      { windowsHide: true, timeout: 2000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  })
};

/** Windows's app mode from `reg query`'s output: AppsUseLightTheme 0x0 is dark; light otherwise, its default. */
export function windowsAppearance(regOutput: string): Appearance {
  return /AppsUseLightTheme\s+REG_DWORD\s+0x0\b/i.test(regOutput) ? "dark" : "light";
}
