import { useEffect, useMemo } from "react";

/**
 * IME (input method editor) guard.
 *
 * Custom Enter handlers — commit a slug, confirm a dialog, use a selection — must not fire while
 * the user is mid-composition in an IME (Japanese, Chinese, Korean, etc.), where Enter merely
 * accepts the candidate. This module is the one place that decides "is Enter part of a composition
 * right now", so every Enter-to-submit handler can share the same rule.
 *
 * Detection combines three signals:
 *   - composition events (`compositionstart` / `compositionend`) tracked on the field,
 *   - `KeyboardEvent.isComposing` on the key event, and
 *   - the legacy `keyCode === 229` fallback (deprecated, intentionally kept; read defensively so
 *     it simply reads `undefined` and is ignored if a browser ever drops it).
 *
 * The composition core ({@link createCompositionTracker}) is framework-agnostic and side-effect
 * free apart from an injectable one-shot scheduler, so it can be unit tested without a DOM. The
 * {@link useImeGuard} hook is the React binding.
 */

/** A subset of `KeyboardEvent` carrying the composition signals we read. `keyCode` is optional. */
export type CompositionKeySignal = {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
};

/** True when the key event itself reports an active composition (no field tracking required). */
export function isComposingKeyboardEvent(event: CompositionKeySignal): boolean {
  if (event.isComposing) return true;
  return event.keyCode === 229;
}

/** Defers a single callback by one tick and can cancel it. Injected so tests can run it manually. */
export interface ClearScheduler {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

const animationFrameScheduler: ClearScheduler = {
  // Referenced lazily inside the methods so importing this module never touches a DOM global.
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle)
};

export interface CompositionTracker {
  /** Call on `compositionstart`. */
  start(): void;
  /** Call on `compositionend`. Clearing is deferred one tick (see below). */
  end(): void;
  /** True while composing, OR when the key event reports composition on its own. */
  isComposing(event: CompositionKeySignal): boolean;
  /** Cancel any deferred clear and reset. Call on teardown. */
  dispose(): void;
}

export function createCompositionTracker(scheduler: ClearScheduler = animationFrameScheduler): CompositionTracker {
  let composing = false;
  let pendingClear: number | null = null;

  function cancelPendingClear(): void {
    if (pendingClear !== null) {
      scheduler.cancel(pendingClear);
      pendingClear = null;
    }
  }

  return {
    start() {
      cancelPendingClear();
      composing = true;
    },
    end() {
      // WebKit/Safari can fire `compositionend` BEFORE the final Enter `keydown`. If we cleared
      // synchronously, that trailing Enter would be treated as a submit. Defer the clear by one
      // tick so the Enter that ends a composition is still classified as composing.
      cancelPendingClear();
      pendingClear = scheduler.schedule(() => {
        composing = false;
        pendingClear = null;
      });
    },
    isComposing(event) {
      return composing || isComposingKeyboardEvent(event);
    },
    dispose() {
      cancelPendingClear();
      composing = false;
    }
  };
}

/** Props spread onto the tracked input/textarea (or any element that hosts text composition). */
export interface ImeCompositionProps {
  onCompositionStart(): void;
  onCompositionEnd(): void;
}

export interface ImeGuard {
  /** Spread onto the field that submits on Enter to track its composition state. */
  readonly compositionProps: ImeCompositionProps;
  /** Call inside an Enter handler; returns true when Enter must NOT submit. */
  isComposing(event: { nativeEvent: CompositionKeySignal }): boolean;
}

/** React binding for {@link createCompositionTracker}, scoped to one field for the component's life. */
export function useImeGuard(): ImeGuard {
  const tracker = useMemo(() => createCompositionTracker(), []);
  useEffect(() => () => tracker.dispose(), [tracker]);
  return useMemo<ImeGuard>(
    () => ({
      compositionProps: {
        onCompositionStart: () => tracker.start(),
        onCompositionEnd: () => tracker.end()
      },
      isComposing: (event) => tracker.isComposing(event.nativeEvent)
    }),
    [tracker]
  );
}
