import type { WindowBounds, WindowPlacementMode, WindowPlacementRecord } from "@shared/types/state";

const CAPTURE_DEBOUNCE_MS = 400;

export type PlacementWindow = {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  getBounds(): WindowBounds;
  setBounds(bounds: WindowBounds): void;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
};

export type WindowPlacementController = {
  start(): void;
  setInitialMode(mode: WindowPlacementMode): void;
  flush(): Promise<void>;
  dispose(): void;
};

type ControllerOptions = {
  initialNormalBounds: WindowBounds;
  initialMode: WindowPlacementMode;
  persist(record: WindowPlacementRecord): Promise<unknown>;
  onError(error: unknown): void;
};

/**
 * Captures only durable normal geometry and normal/maximized mode. Minimized/fullscreen and the
 * event noise around their transitions are deliberately ignored.
 */
export function createWindowPlacementController(
  win: PlacementWindow,
  options: ControllerOptions
): WindowPlacementController {
  let normalBounds = { ...options.initialNormalBounds };
  let mode = options.initialMode;
  let captureEnabled = false;
  let transient = false;
  let manualMove = false;
  let manualResize = false;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelCapture = (): void => {
    if (captureTimer !== undefined) clearTimeout(captureTimer);
    captureTimer = undefined;
    manualMove = false;
    manualResize = false;
  };

  const isOrdinaryNormal = (): boolean =>
    !transient && !win.isMinimized() && !win.isFullScreen() && !win.isMaximized();

  const snapshot = (): WindowPlacementRecord => ({ normalBounds: { ...normalBounds }, mode });

  const persist = (): Promise<unknown> => options.persist(snapshot());

  const persistInBackground = (): void => {
    void persist().catch(options.onError);
  };

  const captureNormalBounds = (): void => {
    if (!captureEnabled || !isOrdinaryNormal()) return;
    normalBounds = { ...win.getBounds() };
    mode = "normal";
  };

  const scheduleNormalCapture = (): void => {
    if (!captureEnabled || !isOrdinaryNormal()) return;
    // Keep the latest candidate in memory immediately. Only the disk write is debounced, so a
    // maximize/minimize/fullscreen transition or close can still preserve the end of the drag.
    captureNormalBounds();
    if (captureTimer !== undefined) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureTimer = undefined;
      manualMove = false;
      manualResize = false;
      persistInBackground();
    }, CAPTURE_DEBOUNCE_MS);
  };

  const enterTransient = (): void => {
    transient = true;
    cancelCapture();
  };

  const leaveTransient = (): void => {
    transient = true;
    cancelCapture();
    captureTimer = setTimeout(() => {
      captureTimer = undefined;
      transient = false;
      if (isOrdinaryNormal()) {
        captureNormalBounds();
        persistInBackground();
      }
    }, CAPTURE_DEBOUNCE_MS);
  };

  const onWillMove = (): void => {
    if (captureEnabled && isOrdinaryNormal()) manualMove = true;
  };
  const onMove = (): void => {
    if (manualMove) scheduleNormalCapture();
  };
  const onWillResize = (): void => {
    if (captureEnabled && isOrdinaryNormal()) manualResize = true;
  };
  const onResize = (): void => {
    if (manualResize) scheduleNormalCapture();
  };
  const onMaximize = (): void => {
    if (!captureEnabled || transient || win.isMinimized() || win.isFullScreen()) return;
    cancelCapture();
    mode = "maximized";
    persistInBackground();
  };
  const onUnmaximize = (): void => leaveTransient();
  const onMinimize = (): void => enterTransient();
  const onRestore = (): void => leaveTransient();
  const onEnterFullScreen = (): void => enterTransient();
  const onLeaveFullScreen = (): void => leaveTransient();

  const listeners: Array<[string, () => void]> = [
    ["will-move", onWillMove],
    ["move", onMove],
    ["will-resize", onWillResize],
    ["resize", onResize],
    ["maximize", onMaximize],
    ["unmaximize", onUnmaximize],
    ["minimize", onMinimize],
    ["restore", onRestore],
    ["enter-full-screen", onEnterFullScreen],
    ["leave-full-screen", onLeaveFullScreen]
  ];
  for (const [event, listener] of listeners) win.on(event, listener);

  return {
    start(): void {
      captureEnabled = true;
      transient = win.isMinimized() || win.isFullScreen();
    },
    setInitialMode(nextMode): void {
      mode = nextMode;
    },
    async flush(): Promise<void> {
      try {
        cancelCapture();
        if (!captureEnabled) return;
        if (win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) mode = "maximized";
        await persist();
      } catch (error) {
        options.onError(error);
      }
    },
    dispose(): void {
      captureEnabled = false;
      cancelCapture();
      for (const [event, listener] of listeners) win.off(event, listener);
    }
  };
}

/**
 * BrowserWindow setters may reject or adjust a rectangle. Restore is all-or-nothing: if Electron
 * does not accept the requested rectangle exactly, put the designed/OS-selected bounds back.
 */
export function applyRestoredWindowBounds(
  win: Pick<PlacementWindow, "getBounds" | "setBounds">,
  bounds: WindowBounds,
  onFailure: (error: unknown) => void
): boolean {
  const fallback = { ...win.getBounds() };
  try {
    win.setBounds(bounds);
    const applied = win.getBounds();
    if (sameBounds(applied, bounds)) return true;
    throw new Error("Electron adjusted the restored window bounds");
  } catch (error) {
    onFailure(error);
    try {
      win.setBounds(fallback);
    } catch (fallbackError) {
      onFailure(fallbackError);
    }
    return false;
  }
}

function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
