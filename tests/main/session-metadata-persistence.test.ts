import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";
import type { AppLogger } from "@main/logger";

const mocks = vi.hoisted(() => ({
  writeTaskSidecarFile: vi.fn<() => Promise<string>>(),
  onWrite: null as (() => void) | null
}));

vi.mock("@main/task-sidecar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@main/task-sidecar")>();
  return { ...original, writeTaskSidecarFile: (...args: unknown[]) => {
    const written = (mocks.writeTaskSidecarFile as (...args: unknown[]) => Promise<string>)(...args);
    mocks.onWrite?.();
    return written;
  } };
});

import { ProjectSession } from "@main/session";
import { describeUnsaved } from "@main/quit-save";

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

  it("reports a failed sidecar write until a quit's retry writes it again with the change", async () => {
    const { session, task } = arrangeSession(savedTask());
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);

    await expect(session.setCustomSlug(task.id, "pier")).rejects.toBe(persistenceFailure);
    expect(task.customSlug).toBe("vision-slug");
    // The quit question names the sidecar the task has, where it is.
    expect(describeUnsaved(session.unsavedSidecars())).toEqual({ failed: [{ kind: "sidecar", file: "photo-fotoready.json" }], running: [] });

    retryUnsaved(session);
    await settleUnsaved(session);

    expect(describeUnsaved(session.unsavedSidecars())).toEqual({ failed: [], running: [] });
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

// The quit's Retry and its wait, over what the session reports as not saved.
function retryUnsaved(session: ProjectSession): void {
  for (const write of session.unsavedSidecars()) if (!write.running) write.retry();
}

async function settleUnsaved(session: ProjectSession): Promise<void> {
  let running = session.unsavedSidecars().filter((write) => write.running);
  while (running.length > 0) {
    await Promise.allSettled(running.map((write) => write.settled));
    running = session.unsavedSidecars().filter((write) => write.running);
  }
}

function arrangeSession(task: Task, logger?: AppLogger): { session: ProjectSession; task: Task } {
  const session = new ProjectSession(
    defaultGlobalSettings(),
    null as never,
    { snapshot: () => ({}) } as never,
    null as never,
    "resources/stamps",
    logger
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
  it.each(["original", "task"])("persists admitted edits after their %s leaves the workspace", async (removed) => {
    const { session, task } = savedSession();
    const written: Array<string | null> = [];
    let release!: () => void;
    mocks.writeTaskSidecarFile.mockImplementationOnce(async (...args: unknown[]) => {
      written.push((args[2] as Task).customSlug);
      await new Promise<void>((resolve) => { release = resolve; });
      return "sidecar";
    }).mockImplementation(async (...args: unknown[]) => {
      expect((args[1] as Original).sourceHash).toBe("source-hash");
      written.push((args[2] as Task).customSlug);
      return "sidecar";
    });
    const first = session.setCustomSlug(task.id, "first");
    await writesStarted(1);
    const second = session.setCustomSlug(task.id, "second");
    if (removed === "original") session.removeOriginal(task.originalId);
    else await session.deleteTask(task.id);
    release();
    await Promise.all([first, second]);
    expect(session.snapshot().project.tasks).toEqual([]);
    expect(written).toEqual(["first", "second"]);
  });

  it("does not retry an obsolete slug over a newer durable submission during quit", async () => {
    const { session, task } = arrangeSession(savedTask());
    let fail!: () => void;
    const written: Array<string | null> = [];
    mocks.writeTaskSidecarFile.mockImplementationOnce(async () => {
      await new Promise<void>((_resolve, reject) => { fail = () => reject(persistenceFailure); });
      return "sidecar";
    }).mockImplementation(async (...args: unknown[]) => {
      written.push((args[2] as Task).customSlug);
      return "sidecar";
    });
    const first = session.setCustomSlug(task.id, "first");
    const rejected = expect(first).rejects.toBe(persistenceFailure);
    await writesStarted(1);
    const second = session.setCustomSlug(task.id, "second");
    fail();
    await rejected;
    await second;
    retryUnsaved(session);
    await settleUnsaved(session);
    expect(task.customSlug).toBe("second");
    expect(written).toEqual(["second"]);
    expect(describeUnsaved(session.unsavedSidecars())).toEqual({ failed: [], running: [] });
  });

  it("retains a failed slug retry when an unrelated flag is saved", async () => {
    const { session, task } = arrangeSession(savedTask());
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    await expect(session.setCustomSlug(task.id, "pier")).rejects.toBe(persistenceFailure);
    await session.setGenerateSlug(task.id, true);
    expect(describeUnsaved(session.unsavedSidecars()).failed).toHaveLength(1);
    retryUnsaved(session);
    await settleUnsaved(session);
    expect(task).toMatchObject({ customSlug: "pier", generateSlug: true, generateDescription: true });
  });

  it("keeps the newer coupled generation choice when quit retries", async () => {
    const { session, task } = arrangeSession(savedTask());
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    await expect(session.setGenerateSlug(task.id, true)).rejects.toBe(persistenceFailure);
    await session.setGenerateDescription(task.id, false);
    retryUnsaved(session);
    await settleUnsaved(session);
    expect(task).toMatchObject({ generateSlug: false, generateDescription: false });
  });

  it.each(["description", "slug"] as const)("retains a failed %s choice after an independent flag no-op", async (field) => {
    const { session, task } = arrangeSession(savedTask());
    task.generateDescription = field === "slug";
    task.generateSlug = field === "slug";
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    const change = field === "description"
      ? session.setGenerateDescription(task.id, true)
      : session.setGenerateSlug(task.id, false);
    await expect(change).rejects.toBe(persistenceFailure);
    if (field === "description") await session.setGenerateSlug(task.id, false);
    else await session.setGenerateDescription(task.id, true);
    expect(describeUnsaved(session.unsavedSidecars()).failed).toHaveLength(1);
    retryUnsaved(session);
    await settleUnsaved(session);
    expect(task).toMatchObject({ generateDescription: true, generateSlug: false });
    expect(mocks.writeTaskSidecarFile).toHaveBeenCalledTimes(2);
  });

  it("skips a queued retry superseded after Retry but before its output lane runs", async () => {
    const { session, task } = arrangeSession(savedTask());
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    await expect(session.setCustomSlug(task.id, "obsolete")).rejects.toBe(persistenceFailure);
    let release!: () => void;
    const written: Array<string | null> = [];
    mocks.writeTaskSidecarFile.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return "sidecar";
    }).mockImplementation(async (...args: unknown[]) => {
      written.push((args[2] as Task).customSlug);
      return "sidecar";
    });
    const held = session.setGenerateDescription(task.id, true);
    await writesStarted(1);
    retryUnsaved(session);
    const latest = session.setCustomSlug(task.id, "latest");
    release();
    await Promise.all([held, latest]);
    await settleUnsaved(session);
    expect(written).toEqual(["latest"]);
    expect(task.customSlug).toBe("latest");
  });

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
    await writesStarted(1);
    expect(written).toEqual(["harbor"]);

    gates.shift()!();
    await first;
    await writesStarted(2);
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
    await writesStarted(1);
    task.output!.finalPath = "/output/harbor.jpg";
    task.output!.stagedPath = "/output/harbor.jpg";
    release();
    await pending;

    expect(task.output).toMatchObject({ finalPath: "/output/harbor.jpg", stagedPath: "/output/harbor.jpg" });
  });
});

/** Resolves once `count` sidecar writes have started, at once when they already have. */
function writesStarted(count: number): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => { if (mocks.writeTaskSidecarFile.mock.calls.length >= count) resolve(); else mocks.onWrite = check; };
    check();
  });
}

describe("saved metadata settlement publication", () => {
  it.each([
    ["custom slug", (session: ProjectSession, task: Task) => session.setCustomSlug(task.id, "pier")],
    ["generation flags", (session: ProjectSession, task: Task) => session.setGenerateSlug(task.id, true)],
    ["cleared vision", (session: ProjectSession, task: Task) => session.clearVision(task.id)]
  ])("returns successful %s to its caller without a duplicate internal snapshot", async (_field, mutate) => {
    const { session, task } = savedSession();
    const listener = vi.fn();
    session.setSnapshotListener(listener);

    const snapshot = await mutate(session, task);

    expect(snapshot.project.tasks[0]).toEqual(task);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["custom slug", (session: ProjectSession, task: Task) => session.setCustomSlug(task.id, "pier")],
    ["generation flags", (session: ProjectSession, task: Task) => session.setGenerateSlug(task.id, true)],
    ["cleared vision", (session: ProjectSession, task: Task) => session.clearVision(task.id)]
  ])("publishes restored %s after another action exposes the pending write", async (_field, mutate) => {
    const { session, task } = savedSession();
    const before = structuredClone(task);
    let visible = structuredClone(task);
    session.setSnapshotListener((snapshot) => { visible = structuredClone(snapshot.project.tasks[0]); });
    let reject!: () => void;
    mocks.writeTaskSidecarFile.mockImplementationOnce(() => new Promise<string>((_resolve, fail) => { reject = () => fail(persistenceFailure); }));
    const writing = mutate(session, task);
    const failed = expect(writing).rejects.toBe(persistenceFailure);
    await writesStarted(1);
    // Another action/processing update publishes the same authority while this save is held.
    await session.emitSnapshot();
    expect(visible).not.toEqual(before);
    reject();
    await failed;
    expect(task).toEqual(before);
    expect(visible).toEqual(before);
  });

  it("publishes a successful sidecar retry even though the original IPC has already failed", async () => {
    const { session, task } = arrangeSession(savedTask());
    const visible: Array<string | null> = [];
    session.setSnapshotListener((snapshot) => { visible.push(snapshot.project.tasks[0].customSlug); });
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    await expect(session.setCustomSlug(task.id, "pier")).rejects.toBe(persistenceFailure);
    retryUnsaved(session);
    await settleUnsaved(session);
    expect(task.customSlug).toBe("pier");
    expect(visible).toEqual(["vision-slug", "pier"]);
  });

  it("keeps a successful quit retry saved when its settlement notification fails", async () => {
    const { session, task } = arrangeSession(savedTask());
    const listener = vi.fn(async () => { throw new Error("window notification failed"); });
    session.setSnapshotListener(listener);
    mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    await expect(session.setCustomSlug(task.id, "pier")).rejects.toBe(persistenceFailure);

    retryUnsaved(session);
    await settleUnsaved(session);

    expect(task.customSlug).toBe("pier");
    expect(describeUnsaved(session.unsavedSidecars())).toEqual({ failed: [], running: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "failure"])("keeps a notification failure separate from persistence %s", async (outcome) => {
    const { session, task } = savedSession();
    session.setSnapshotListener(async () => { throw new Error("window notification failed"); });
    if (outcome === "failure") mocks.writeTaskSidecarFile.mockRejectedValueOnce(persistenceFailure);
    const writing = session.setCustomSlug(task.id, "pier");
    if (outcome === "failure") await expect(writing).rejects.toBe(persistenceFailure);
    else await expect(writing).resolves.toBeDefined();
    expect(task.customSlug).toBe(outcome === "success" ? "pier" : "vision-slug");
  });
});
