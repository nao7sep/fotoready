import { beforeEach, describe, expect, it, vi } from "vitest";

// The stack is module-level singleton state, so each test gets a fresh module instance.
let stack: typeof import("@renderer/components/modals/modal-stack");

beforeEach(async () => {
  vi.resetModules();
  stack = await import("@renderer/components/modals/modal-stack");
});

describe("modal-stack", () => {
  it("reports no modal open until one is pushed", () => {
    expect(stack.isModalOpen()).toBe(false);
    const id = Symbol("a");
    stack.pushModalLayer(id);
    expect(stack.isModalOpen()).toBe(true);
    stack.removeModalLayer(id);
    expect(stack.isModalOpen()).toBe(false);
  });

  it("treats only the most recently pushed layer as topmost", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    stack.pushModalLayer(a);
    expect(stack.isTopModalLayer(a)).toBe(true);

    stack.pushModalLayer(b);
    expect(stack.isTopModalLayer(b)).toBe(true);
    expect(stack.isTopModalLayer(a)).toBe(false);

    // Closing the top hands "topmost" back to the layer beneath it.
    stack.removeModalLayer(b);
    expect(stack.isTopModalLayer(a)).toBe(true);
    expect(stack.isModalOpen()).toBe(true);
  });

  it("handles a middle layer closing out of order without disturbing the top", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    const c = Symbol("c");
    stack.pushModalLayer(a);
    stack.pushModalLayer(b);
    stack.pushModalLayer(c);

    // e.g. a confirm (b) settles programmatically while a deeper modal (c) is still open.
    stack.removeModalLayer(b);
    expect(stack.isTopModalLayer(c)).toBe(true);
    expect(stack.isModalOpen()).toBe(true);

    stack.removeModalLayer(c);
    expect(stack.isTopModalLayer(a)).toBe(true);

    stack.removeModalLayer(a);
    expect(stack.isModalOpen()).toBe(false);
  });

  it("ignores removal of a layer that was never pushed", () => {
    const a = Symbol("a");
    stack.pushModalLayer(a);
    expect(() => stack.removeModalLayer(Symbol("ghost"))).not.toThrow();
    expect(stack.isTopModalLayer(a)).toBe(true);
    expect(stack.isModalOpen()).toBe(true);
  });

  it("reports no topmost layer when the stack is empty", () => {
    expect(stack.isTopModalLayer(Symbol("a"))).toBe(false);
  });
});
