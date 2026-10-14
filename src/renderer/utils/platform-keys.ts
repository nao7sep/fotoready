import type { NodeProcessPlatform } from "@shared/types/ipc";

// Until the platform is known the app assumes macOS (keyboard-shortcut-conventions: Cmd-first).
function isMac(platform: NodeProcessPlatform | null): boolean {
  return platform === null || platform === "darwin";
}

/** The running platform's single modifier word for shown shortcuts, never the combined "Cmd/Ctrl". */
export function modifierLabel(platform: NodeProcessPlatform | null): "Cmd" | "Ctrl" {
  return isMac(platform) ? "Cmd" : "Ctrl";
}

/**
 * Whether a chord belongs to the text system instead of the app's shortcuts. On macOS, Ctrl inside
 * a text field belongs to the text system whatever the key is, so the Ctrl half of a dual-bound
 * chord stands down there; one blanket test, no per-chord key list. The Cmd half is the binding and
 * always fires.
 */
export function chordBelongsToTextField(
  platform: NodeProcessPlatform | null,
  keys: { ctrlKey: boolean; metaKey: boolean },
  inTextField: boolean
): boolean {
  return isMac(platform) && keys.ctrlKey && !keys.metaKey && inTextField;
}
