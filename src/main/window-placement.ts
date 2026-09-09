import { createWindowsPlacement, type WindowsPlacement } from "./windows-placement";
import type { WindowsNormalBounds } from "@shared/windows-placement";
import type { WindowBounds, WindowPlacementMode, WindowPlacementRecord } from "@shared/types/state";

export type PlacementWindow = {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  getBounds(): WindowBounds;
  getNormalBounds(): WindowBounds;
  setBounds(bounds: WindowBounds): void;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
};

export function applyRestoredWindowBounds(
  win: Pick<PlacementWindow, "getBounds" | "setBounds">,
  bounds: WindowBounds,
  onError: (error: unknown) => void,
): boolean {
  let opening: WindowBounds | undefined;
  try {
    opening = win.getBounds();
    win.setBounds(bounds);
    return true;
  } catch (error) {
    onError(error);
    if (opening) {
      try { win.setBounds(opening); } catch (fallbackError) { onError(fallbackError); }
    }
    return false;
  }
}

export function initializeWindowPlacement(
  win: PlacementWindow & { getNativeWindowHandle(): Buffer },
  saved: WindowPlacementRecord | null,
  restoration: { normalBounds: WindowBounds | null; mode: WindowPlacementMode },
  onError: (error: unknown) => void,
): { initial: WindowPlacementRecord; windows: WindowsPlacement | undefined } {
  let windows: WindowsPlacement | undefined;
  try { windows = createWindowsPlacement(win); } catch (error) { onError(error); }
  if (windows && saved?.windowsNormalBounds) {
    try { windows.restoreHidden(saved.windowsNormalBounds); } catch (error) { onError(error); }
  } else if (restoration.normalBounds) {
    applyRestoredWindowBounds(win, restoration.normalBounds, onError);
  }
  // A geometry read failure leaves the useful opening window and valid mode
  // intact. It does not require inventing a rectangle to persist.
  const initial: WindowPlacementRecord = { normalBounds: null, mode: restoration.mode };
  try { initial.normalBounds = win.getNormalBounds(); } catch (error) { onError(error); }
  if (windows) {
    try { initial.windowsNormalBounds = windows.read(); } catch (error) { onError(error); }
  }
  return { initial, windows };
}

// electron-window-state overwrites maximized intent during transient states and
// owns a separate store. Use SDK geometry with our ordered store; on Windows,
// the native placement pair avoids Electron's lossy DIP rectangle conversion.
export function createWindowPlacementController(
  win: PlacementWindow,
  options: {
    initialNormalBounds: WindowBounds | null;
    initialMode: WindowPlacementMode;
    initialWindowsNormalBounds?: WindowsNormalBounds | null | undefined;
    windowsPlacement?: WindowsPlacement | undefined;
    persist(record: WindowPlacementRecord): Promise<unknown>;
    onError(error: unknown): void;
  },
): { start(): void; flush(): Promise<void>; dispose(): void } {
  const { persist, onError } = options;
  const initial = { normalBounds: options.initialNormalBounds, mode: options.initialMode };
  let normalBounds = initial.normalBounds ? { ...initial.normalBounds } : null;
  let windowsNormalBounds = options.initialWindowsNormalBounds;
  const windowsPlacement = options.windowsPlacement;
  let mode = initial.mode;
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => { clearTimeout(timer); timer = undefined; };
  const capture = (): void => {
    if (win.isMinimized() || win.isFullScreen()) return;
    mode = win.isMaximized() ? "maximized" : "normal";
    // Commit both geometry representations together, leaving the prior pair on failure.
    const logical = { ...win.getNormalBounds() };
    const native = windowsPlacement?.read();
    normalBounds = logical;
    windowsNormalBounds = native;
  };
  const save = async (): Promise<void> => {
    try { await persist({ normalBounds: normalBounds ? { ...normalBounds } : null, mode,
      ...(windowsPlacement ? { windowsNormalBounds: windowsNormalBounds ? { ...windowsNormalBounds } : null } : {}),
    }); }
    catch (error) { onError(error); }
  };
  const schedule = (): void => {
    if (!enabled || win.isMinimized() || win.isFullScreen()) return;
    try { capture(); } catch (error) { onError(error); }
    cancel();
    timer = setTimeout(() => { timer = undefined; void save(); }, 400);
  };
  const onMaximize = (): void => {
    if (!enabled || win.isMinimized() || win.isFullScreen()) return;
    try { capture(); } catch (error) { onError(error); }
    cancel();
    void save();
  };
  const listeners: Array<[string, () => void]> = [
    ["move", schedule], ["resize", schedule], ["maximize", onMaximize],
    ["unmaximize", schedule], ["restore", schedule], ["leave-full-screen", schedule],
    ["minimize", cancel], ["enter-full-screen", cancel],
  ];
  for (const [event, listener] of listeners) win.on(event, listener);

  return {
    start: () => { enabled = true; },
    flush: async () => {
      cancel();
      if (!enabled) return;
      try { capture(); } catch (error) { onError(error); }
      await save();
    },
    dispose: () => {
      enabled = false;
      cancel();
      for (const [event, listener] of listeners) win.off(event, listener);
    },
  };
}
