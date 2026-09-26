/**
 * Whether closing the last window ends the app. macOS keeps an app running with no window, so the
 * workspace and any running saves outlive a window close there; elsewhere closing the window quits.
 */
export function windowCloseQuits(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}
