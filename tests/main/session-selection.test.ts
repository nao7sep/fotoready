import { describe, expect, it } from "vitest";
import { pickActiveTaskAfterOriginalRemoval } from "@main/session-selection";

describe("pickActiveTaskAfterOriginalRemoval", () => {
  const original = (id: string) => ({ id });
  const task = (id: string, originalId: string) => ({ id, originalId });

  it("selects the task of the original that slid into the removed slot", () => {
    // Removed the middle original (index 1); [a, c] remain, so the neighbour is c.
    const remainingOriginals = [original("a"), original("c")];
    const remainingTasks = [task("ta", "a"), task("tc", "c")];
    expect(pickActiveTaskAfterOriginalRemoval(remainingOriginals, 1, remainingTasks)).toBe("tc");
  });

  it("falls back to the previous original after removing the last one", () => {
    // Removed the last original (index 2); [a, b] remain, so the neighbour is b.
    const remainingOriginals = [original("a"), original("b")];
    const remainingTasks = [task("ta", "a"), task("tb", "b")];
    expect(pickActiveTaskAfterOriginalRemoval(remainingOriginals, 2, remainingTasks)).toBe("tb");
  });

  it("uses the neighbour's first task when it has several", () => {
    const remainingOriginals = [original("a"), original("c")];
    const remainingTasks = [task("ta", "a"), task("tc1", "c"), task("tc2", "c")];
    expect(pickActiveTaskAfterOriginalRemoval(remainingOriginals, 1, remainingTasks)).toBe("tc1");
  });

  it("falls back to the first remaining task when the neighbour has no task", () => {
    // c's task slot was reused away, so c has no task; fall back to the first task.
    const remainingOriginals = [original("a"), original("c")];
    const remainingTasks = [task("ta", "a")];
    expect(pickActiveTaskAfterOriginalRemoval(remainingOriginals, 1, remainingTasks)).toBe("ta");
  });

  it("returns null when no tasks remain", () => {
    expect(pickActiveTaskAfterOriginalRemoval([], 0, [])).toBeNull();
  });
});
