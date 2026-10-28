import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@renderer/state/editor-store";
import { createEmptyProject, defaultPipeline } from "@shared/defaults";
import type { ProjectSnapshot } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";

function snapshot(taskId = "task-1"): ProjectSnapshot {
  const pipeline = defaultPipeline();
  pipeline.ops = [{ id: "selected-op", type: "rotate", enabled: true, params: { degrees: 90 } }];
  const task: Task = {
    id: taskId, originalId: "original-1", generateDescription: false, generateSlug: false, customSlug: null,
    visionRunning: false, visionRunMode: null, pipeline, status: "not-saved", output: null, error: null,
    everEdited: true, createdAt: "2026-10-23T00:00:00.000Z", updatedAt: "2026-10-23T00:00:00.000Z"
  };
  return { project: { ...createEmptyProject(), tasks: [task] }, activeTaskId: taskId, privacyWarnings: {} };
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

describe("editor project snapshots", () => {
  it("accepts a newer snapshot and keeps an existing selection on the same task", () => {
    useEditorStore.getState().setProjectSnapshot(snapshot());
    useEditorStore.getState().selectOp("selected-op");
    const newer = snapshot();
    newer.project.tasks[0]!.pipeline.ops[0]!.params.degrees = 180;

    useEditorStore.getState().setProjectSnapshot(newer);

    expect(useEditorStore.getState().projectSnapshot).toBe(newer);
    expect(useEditorStore.getState().selectedOpId).toBe("selected-op");
  });

  it("accepts a newer active task and clears the previous task's selected op", () => {
    useEditorStore.getState().setProjectSnapshot(snapshot());
    useEditorStore.getState().selectOp("selected-op");
    const newer = snapshot("new-task");

    useEditorStore.getState().setProjectSnapshot(newer);

    expect(useEditorStore.getState().projectSnapshot).toBe(newer);
    expect(useEditorStore.getState().selectedOpId).toBeNull();
  });
});
