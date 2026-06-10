import { describe, expect, it } from "vitest";
import { tabTrapTarget } from "@renderer/components/modals/focus-trap";

describe("tabTrapTarget", () => {
  it("does not interfere when focus is mid-list", () => {
    expect(tabTrapTarget({ count: 4, activeIndex: 1, shiftKey: false })).toBeNull();
    expect(tabTrapTarget({ count: 4, activeIndex: 2, shiftKey: true })).toBeNull();
  });

  it("wraps forward off the last element and backward off the first", () => {
    expect(tabTrapTarget({ count: 3, activeIndex: 2, shiftKey: false })).toBe("first");
    expect(tabTrapTarget({ count: 3, activeIndex: 0, shiftKey: true })).toBe("last");
  });

  it("does not wrap forward off the first or backward off the last", () => {
    expect(tabTrapTarget({ count: 3, activeIndex: 0, shiftKey: false })).toBeNull();
    expect(tabTrapTarget({ count: 3, activeIndex: 2, shiftKey: true })).toBeNull();
  });

  it("pulls focus to an edge when it sits on the surface or escapes (activeIndex < 0)", () => {
    // The regression case: focus on the modal <section> (tabIndex=-1, not in the focusable list)
    // is not "inside" any boundary, so Shift+Tab must still wrap to the last element rather than
    // letting the browser walk focus into the window behind the modal.
    expect(tabTrapTarget({ count: 3, activeIndex: -1, shiftKey: true })).toBe("last");
    expect(tabTrapTarget({ count: 3, activeIndex: -1, shiftKey: false })).toBe("first");
  });

  it("handles a single focusable element by wrapping to itself", () => {
    // first === last; both directions stay on the only control (e.g. a header-only modal whose
    // sole focusable is the close button).
    expect(tabTrapTarget({ count: 1, activeIndex: 0, shiftKey: false })).toBe("first");
    expect(tabTrapTarget({ count: 1, activeIndex: 0, shiftKey: true })).toBe("last");
  });

  it("defers to the caller when there are no focusable elements", () => {
    expect(tabTrapTarget({ count: 0, activeIndex: -1, shiftKey: false })).toBeNull();
  });
});
