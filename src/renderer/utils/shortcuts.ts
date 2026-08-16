/**
 * The one shared command-modifier predicate (keyboard-shortcut-conventions):
 * BOTH Cmd and Ctrl fire on every platform, and Alt is excluded because
 * Chromium delivers Windows AltGr as Ctrl+Alt — an unguarded predicate would
 * let an AltGr-typed character (unmapped combos fall back to the base key)
 * fire an accelerator and swallow the character. Every accelerator site
 * imports this; a per-file copy is what lets two chords disagree.
 */
export function hasMod(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

// Bare-Ctrl chords on these keys shadow Cocoa's text-editing keymap
// (StandardKeyBinding.dict — Ctrl+H is delete-backward, Ctrl+N next-line,
// and Ctrl+Slash is bound too).
const COCOA_CTRL_TEXT_KEYS = new Set([
  "a", "b", "d", "e", "f", "h", "k", "l", "n", "o", "p", "t", "v", "y", "/",
  // Ctrl+Return is insertLineBreak: — omitting it let Ctrl+Return in a text field
  // both swallow the line break and fire the chord.
  "Enter",
]);

/**
 * True when this chord shadows a macOS text-editing binding and must stand
 * down while the event target is editable; the Cmd half of the same chord is
 * unbound there and always fires. The platform is injected — fotoready learns
 * it over IPC — and an unknown platform is treated as macOS, matching the
 * app's Mac-first display default (keyboard-shortcut-conventions).
 */
export function shadowsMacTextBinding(event: KeyboardEvent, isMac: boolean): boolean {
  if (!isMac) return false;
  if (event.metaKey || !event.ctrlKey) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return COCOA_CTRL_TEXT_KEYS.has(key);
}
