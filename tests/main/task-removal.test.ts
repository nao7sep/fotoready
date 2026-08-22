import { describe, expect, it } from "vitest";
import { defaultPipeline } from "@shared/defaults";
import type { Task, TaskStatus } from "@shared/types/project";
import { isTaskBusyForRemoval } from "@main/task-removal";

function task(status: TaskStatus, visionRunning = false): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning,
    visionRunMode: visionRunning ? "description" : null,
    pipeline: defaultPipeline(),
    status,
    output: null,
    error: null,
    everEdited: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("isTaskBusyForRemoval", () => {
  it.each(["queued", "processing"] as const)("blocks removal while a task is %s", (status) => {
    expect(isTaskBusyForRemoval(task(status))).toBe(true);
  });

  it("blocks removal while vision can still mutate the saved task or sidecar", () => {
    expect(isTaskBusyForRemoval(task("saved", true))).toBe(true);
  });

  it.each(["not-saved", "saved", "error"] as const)("allows removal when an idle task is %s", (status) => {
    expect(isTaskBusyForRemoval(task(status))).toBe(false);
  });
});
