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
import { UserWorkWrites } from "@main/quit-save";

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

  it("keeps a sidecar write that fails during a quit, which the quit's retry writes again with the change", async () => {
    const userWork = new UserWorkWrites();
    const { session, task } = arrangeSession(savedTask(), userWork);
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    userWork.beginQuit();

    await expect(session.setCustomSlug(task.id, "pier")).rejects.toBe(persistenceFailure);
    expect(task.customSlug).toBe("vision-slug");
    // The quit question names the sidecar the task has, where it is.
    expect(userWork.unsaved()).toEqual({ failed: [{ kind: "sidecar", file: "photo-fotoready.json" }], running: [] });

    userWork.retry();
    await userWork.settle(1_000);

    expect(userWork.unsaved()).toEqual({ failed: [], running: [] });
    expect(task.customSlug).toBe("pier");
    expect(mocks.writeTaskSidecarFile).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["spaces on an empty slug", null, "   "],
    ["a case change", "pier", "PIER"]
  ])("records no edit for a custom slug that normalizes to the stored one (%s)", async (_label, stored, typed) => {
    for (const { session, task } of [savedSession(), notSavedSession()]) {
      task.customSlug = stored;
      task.everEdited = false;
      const before = structuredClone(task);

      await session.setCustomSlug(task.id, typed);

      expect(session.snapshot().project.tasks[0]).toEqual(before);
    }
    // No undo step was recorded either: undoing leaves the not-saved task as it is.
    const { session, task } = notSavedSession();
    task.customSlug = stored;
    await session.setCustomSlug(task.id, typed);
    session.undoTaskEdit(task.id);
    expect(session.snapshot().project.tasks[0]).toBe(task);
    expect(mocks.writeTaskSidecarFile).not.toHaveBeenCalled();
  });

  it("skips canonical flag no-ops without persistence, edit time or undo", async () => {
    for (const { session, task } of [savedSession(), notSavedSession()]) {
      task.generateDescription = true;
      task.generateSlug = true;
      const before = structuredClone(task);
      await session.setGenerateDescription(task.id, false);
      await session.setGenerateSlug(task.id, true);
      expect(task).toEqual(before);
      if (task.status === "not-saved") session.undoTaskEdit(task.id);
      expect(session.snapshot().project.tasks[0]).toBe(task);
    }
    expect(mocks.writeTaskSidecarFile).not.toHaveBeenCalled();
  });

  it("retains each input time while metadata waits behind an earlier sidecar write", async () => {
    const { session, task } = savedSession();
    let release!: () => void;
    mocks.writeTaskSidecarFile.mockImplementationOnce(() => new Promise<string>((resolve) => { release = () => resolve("sidecar"); }));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T01:00:00Z"));
      const first = session.setCustomSlug(task.id, "first");
      await Promise.resolve();
      await Promise.resolve();
      vi.setSystemTime(new Date("2026-10-07T01:01:00Z"));
      const second = session.setGenerateSlug(task.id, true);
      vi.setSystemTime(new Date("2026-10-07T01:02:00Z"));
      release();
      await Promise.all([first, second]);
      expect(task.updatedAt).toBe("2026-10-07T01:01:00.000Z");
    } finally { vi.useRealTimers(); }
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

function arrangeSession(task: Task, userWork?: UserWorkWrites): { session: ProjectSession; task: Task } {
  const session = new ProjectSession(
    defaultGlobalSettings(),
    null as never,
    null as never,
    null as never,
    "resources/stamps",
    undefined,
    userWork
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
      message: { key: "visionError.generic" },
      detail: null,
      occurredAt: "2026-09-01T00:00:00.000Z",
      retryable: true,
      retryMode: "description"
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

describe("ProjectSession sidecar write ordering", () => {
  it("writes one sidecar at a time, each from the state current when it runs", async () => {
    const { session, task } = savedSession();
    const gates: Array<() => void> = [];
    const written: Array<string | null> = [];
    mocks.writeTaskSidecarFile.mockImplementation(async (...args: unknown[]) => {
      written.push((args[2] as Task).customSlug);
      await new Promise<void>((resolve) => gates.push(resolve));
      return "/output/photo-fotoready.json";
    });

    const first = session.setCustomSlug(task.id, "harbor");
    const second = session.setCustomSlug(task.id, "harbor-sunset");
    await flush();
    expect(written).toEqual(["harbor"]);

    gates.shift()!();
    await first;
    await flush();
    expect(written).toEqual(["harbor", "harbor-sunset"]);
    gates.shift()!();
    await second;
    expect(task.customSlug).toBe("harbor-sunset");
  });

  it("rolls back only its own change when an earlier write fails", async () => {
    const { session, task } = savedSession();
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);

    const first = session.setCustomSlug(task.id, "harbor");
    const second = session.setCustomSlug(task.id, "harbor-sunset");

    await expect(first).rejects.toBe(persistenceFailure);
    await second;
    expect(task.customSlug).toBe("harbor-sunset");
  });

  it("never writes back an output path that a rename changed while the sidecar was written", async () => {
    const { session, task } = savedSession();
    let release!: () => void;
    mocks.writeTaskSidecarFile.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return "/output/photo-fotoready.json";
    });

    const pending = session.setCustomSlug(task.id, "harbor");
    await flush();
    task.output!.finalPath = "/output/harbor.jpg";
    task.output!.stagedPath = "/output/harbor.jpg";
    release();
    await pending;

    expect(task.output).toMatchObject({ finalPath: "/output/harbor.jpg", stagedPath: "/output/harbor.jpg" });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
