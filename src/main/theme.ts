import { BrowserWindow, nativeTheme } from "electron";
import type { ThemePreference } from "@shared/types/settings";

// Electron's nativeTheme.themeSource is FotoReady's one theme authority (app-chrome conventions,
// Theme): it paints the native title bar, menus, and dialogs, and it decides `prefers-color-scheme`
// in every renderer, which is what app.css's dark block and the plain message dialog follow. No
// renderer resolves System itself.

// app.css's --app-bg in each theme, so the frames before a page paints and the backing exposed
// while resizing already match it.
const LIGHT_BACKGROUND = "#f5f5f4";
const DARK_BACKGROUND = "#171412";

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
