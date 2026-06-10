import { describe, expect, it } from "vitest";
import { type ClearScheduler, createCompositionTracker, isComposingKeyboardEvent } from "@renderer/utils/ime-guard";

/** A scheduler whose deferred clears run only when the test flushes them. */
function manualScheduler(): { scheduler: ClearScheduler; flush(): void; pending(): number } {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    scheduler: {
      schedule(callback) {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel(handle) {
        callbacks.delete(handle);
      }
    },
    flush() {
      for (const callback of [...callbacks.values()]) callback();
      callbacks.clear();
    },
    pending() {
      return callbacks.size;
    }
  };
}

describe("isComposingKeyboardEvent", () => {
  it("is true when the event reports an active composition", () => {
    expect(isComposingKeyboardEvent({ isComposing: true })).toBe(true);
  });

  it("falls back to the legacy keyCode === 229 signal", () => {
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("is false for a normal Enter and when both signals are absent", () => {
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isComposingKeyboardEvent({})).toBe(false);
  });
});

describe("createCompositionTracker", () => {
  it("is not composing before any composition begins", () => {
    const { scheduler } = manualScheduler();
    const tracker = createCompositionTracker(scheduler);
    expect(tracker.isComposing({})).toBe(false);
  });

  it("still honours the key-event signals while idle", () => {
    const { scheduler } = manualScheduler();
    const tracker = createCompositionTracker(scheduler);
    expect(tracker.isComposing({ isComposing: true })).toBe(true);
    expect(tracker.isComposing({ keyCode: 229 })).toBe(true);
  });

  it("reports composing between start and the deferred clear, then clears", () => {
    const manual = manualScheduler();
    const tracker = createCompositionTracker(manual.scheduler);

    tracker.start();
    expect(tracker.isComposing({})).toBe(true);

    // WebKit can deliver compositionend BEFORE the final Enter keydown: the clear is deferred,
    // so a trailing Enter that arrives before the next tick is still seen as composing.
    tracker.end();
    expect(manual.pending()).toBe(1);
    expect(tracker.isComposing({})).toBe(true);

    manual.flush();
    expect(tracker.isComposing({})).toBe(false);
  });

  it("cancels a pending clear when a new composition starts", () => {
    const manual = manualScheduler();
    const tracker = createCompositionTracker(manual.scheduler);

    tracker.start();
    tracker.end();
    tracker.start();
    expect(manual.pending()).toBe(0); // the second start cancelled the deferred clear

    manual.flush(); // nothing to run
    expect(tracker.isComposing({})).toBe(true);
  });

  it("keeps only one deferred clear when compositionend fires repeatedly", () => {
    const manual = manualScheduler();
    const tracker = createCompositionTracker(manual.scheduler);

    tracker.start();
    tracker.end();
    tracker.end();
    expect(manual.pending()).toBe(1);

    manual.flush();
    expect(tracker.isComposing({})).toBe(false);
  });

  it("dispose cancels a pending clear and resets composing state", () => {
    const manual = manualScheduler();
    const tracker = createCompositionTracker(manual.scheduler);

    tracker.start();
    tracker.end();
    tracker.dispose();
    expect(manual.pending()).toBe(0);
    expect(tracker.isComposing({})).toBe(false);
  });
});
