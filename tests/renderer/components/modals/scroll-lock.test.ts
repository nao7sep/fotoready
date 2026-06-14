import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The lock is module-level singleton state, so each test gets a fresh module instance.
let lock: typeof import("@renderer/components/modals/scroll-lock");

// Tests run in the node environment (no DOM). The DOM binding is exercised only on the 0<->1 edge
// and is verified by manual QA; here we stub a minimal `document.body.classList` so the edge calls
// are no-ops, and assert the pure reference-counted transitions the helpers return.
beforeEach(async () => {
  vi.stubGlobal("document", { body: { classList: { toggle() {} } } });
  vi.resetModules();
  lock = await import("@renderer/components/modals/scroll-lock");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scroll-lock", () => {
  it("locks on the first acquire only", () => {
    expect(lock.acquireScrollLock()).toBe(true);
  });

  it("stays locked across nested acquires without re-locking", () => {
    expect(lock.acquireScrollLock()).toBe(true);
    expect(lock.acquireScrollLock()).toBe(false);
    expect(lock.acquireScrollLock()).toBe(false);
  });

  it("stays locked until the last reference is released", () => {
    lock.acquireScrollLock();
    lock.acquireScrollLock();
    lock.acquireScrollLock();

    // Releasing intermediate references does not unlock the body.
    expect(lock.releaseScrollLock()).toBe(false);
    expect(lock.releaseScrollLock()).toBe(false);
    // The last release unlocks.
    expect(lock.releaseScrollLock()).toBe(true);
  });

  it("clamps at zero so an extra or unbalanced release never goes negative", () => {
    // Release with no outstanding lock is a no-op.
    expect(lock.releaseScrollLock()).toBe(false);

    lock.acquireScrollLock();
    expect(lock.releaseScrollLock()).toBe(true);

    // An extra release past zero is still a no-op, and the next acquire locks cleanly from 0->1.
    expect(lock.releaseScrollLock()).toBe(false);
    expect(lock.acquireScrollLock()).toBe(true);
  });
});
