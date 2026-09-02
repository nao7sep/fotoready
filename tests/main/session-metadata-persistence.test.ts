import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";

const mocks = vi.hoisted(() => ({
  writeTaskSidecarFile: vi.fn<() => Promise<string>>()
}));

vi.mock("@main/task-sidecar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@main/task-sidecar")>();
  return { ...original, writeTaskSidecarFile: mocks.writeTaskSidecarFile };
});

import { ProjectSession } from "@main/session";

const persistenceFailure = new Error("sidecar persistence failed");

beforeEach(() => {
  mocks.writeTaskSidecarFile.mockReset();
  mocks.writeTaskSidecarFile.mockResolvedValue("/output/photo-fotoready.json");
});

describe("ProjectSession saved-task metadata persistence", () => {
  it.each([
    ["description flag", (session: ProjectSession, task: Task) => session.setGenerateDescription(task.id, true)],
    ["slug flag", (session: ProjectSession, task: Task) => session.setGenerateSlug(task.id, true)],
    ["custom slug", (session: ProjectSession, task: Task) => session.setCustomSlug(task.id, "replacement-slug")],
    ["vision result", (session: ProjectSession, task: Task) => session.clearVision(task.id)]
  ])("restores the exact task when the %s sidecar write rejects", async (_label, mutate) => {
    const { session, task } = savedSession();
    const before = structuredClone(task);
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);

    await expect(mutate(session, task)).rejects.toBe(persistenceFailure);

    const restored = session.snapshot().project.tasks[0];
    expect(restored).toBe(task);
    expect(restored).toEqual(before);
    expect(mocks.writeTaskSidecarFile).toHaveBeenCalledTimes(1);
  });

  it("preserves not-saved metadata edits and their undo history", async () => {
    const { session, task } = notSavedSession();

    await session.setGenerateSlug(task.id, true);
    expect(task).toMatchObject({ generateDescription: true, generateSlug: true });
    expect(mocks.writeTaskSidecarFile).not.toHaveBeenCalled();

    session.undoTaskEdit(task.id);
    expect(session.snapshot().project.tasks[0]).toMatchObject({
      generateDescription: false,
      generateSlug: false
    });
  });
});

function savedSession(): { session: ProjectSession; task: Task } {
  return arrangeSession(savedTask());
}

function notSavedSession(): { session: ProjectSession; task: Task } {
  const task = savedTask();
  task.status = "not-saved";
  task.output = null;
  return arrangeSession(task);
}

function arrangeSession(task: Task): { session: ProjectSession; task: Task } {
  const session = new ProjectSession(
    defaultGlobalSettings(),
    null as never,
    null as never,
    null as never
  );
  const project = session.snapshot().project;
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task };
}

function savedTask(): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: "vision-slug",
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: "saved",
    output: {
      stagedPath: "/output/photo.jpg",
      stagedParamsPath: "/output/photo-fotoready.json",
      stagedAt: "2026-09-01T00:00:00.000Z",
      outputHash: "output-hash",
      vision: {
        description: "A photo",
        slugCandidates: ["vision-slug"],
        model: "gemini-test",
        ranAt: "2026-09-01T00:00:00.000Z"
      },
      finalPath: "/output/photo.jpg",
      finalParamsPath: "/output/photo-fotoready.json",
      renamedAt: null
    },
    error: {
      stage: "vision",
      message: "Previous vision result",
      detail: null,
      occurredAt: "2026-09-01T00:00:00.000Z",
      retryable: true
    },
    everEdited: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function original(): Original {
  return {
    id: "original-1",
    sourcePath: "/source/photo.jpg",
    sourceHash: "source-hash",
    size: 100,
    format: "jpeg",
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 100,
    height: 80,
    addedAt: "2026-09-01T00:00:00.000Z"
  };
}
