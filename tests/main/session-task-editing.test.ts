import { describe, expect, it } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task, TaskStatus } from "@shared/types/project";
import { isTaskEditable } from "@shared/task-editing";
import { ProjectSession } from "@main/session";

/**
 * The authority behind the ops panel and the canvas: whatever `isTaskEditable`
 * locks, the session refuses through every path that changes a task's pipeline.
 * The canvas used to draw drag handles over these tasks, so the refusal here is
 * what the interface must agree with rather than talk the user into.
 */

const LOCKED_STATUSES = (["not-saved", "queued", "processing", "saved", "error"] as TaskStatus[])
  .filter((status) => !isTaskEditable(status));

describe("ProjectSession pipeline edits on a locked task", () => {
  it.each(LOCKED_STATUSES)("refuses every pipeline path while the task is %s", async (status) => {
    const { session, task } = arrange(status);
    const before = structuredClone(task);

    await expect(session.addOp(task.id, "rotate")).rejects.toThrow(/not-saved/);
    expect(() => session.removeOp(task.id, "op-1")).toThrow(/not-saved/);
    expect(() => session.moveOp(task.id, "op-1", 0)).toThrow(/not-saved/);
    expect(() => session.setOpEnabled(task.id, "op-1", false)).toThrow(/not-saved/);
    expect(() => session.updateOpParam(task.id, "op-1", "x", 0.5)).toThrow(/not-saved/);
    expect(() => session.updateOpParams(task.id, "op-1", { x: 0.5 })).toThrow(/not-saved/);
    expect(() => session.updateOutput(task.id, "quality", 50)).toThrow(/not-saved/);

    expect(session.snapshot().project.tasks[0]).toEqual(before);
  });

  it("takes the same edits while the task is not saved", async () => {
    const { session, task } = arrange("not-saved");

    await session.addOp(task.id, "rotate");
    session.updateOpParam(task.id, "op-1", "x", 0.25);

    const edited = session.snapshot().project.tasks[0];
    expect(edited.pipeline.ops).toHaveLength(2);
    expect(edited.pipeline.ops[0].params.x).toBe(0.25);
  });
});

function arrange(status: TaskStatus): { session: ProjectSession; task: Task } {
  const session = new ProjectSession(
    defaultGlobalSettings(),
    null as never,
    null as never,
    null as never
  );
  const task = taskWithOneOp(status);
  const project = session.snapshot().project;
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task };
}

function taskWithOneOp(status: TaskStatus): Task {
  const pipeline = defaultPipeline();
  pipeline.ops = [{ id: "op-1", type: "crop", params: { x: 0, y: 0, w: 1, h: 1, aspectLock: null }, enabled: true }];
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline,
    status,
    output: null,
    error: null,
    everEdited: false,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z"
  };
}

function original(): Original {
  return {
    id: "original-1",
    sourcePath: "/originals/photo.jpg",
    sourceHash: "source-hash",
    size: 1024,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 1000,
    height: 800,
    addedAt: "2026-09-20T00:00:00.000Z"
  };
}
