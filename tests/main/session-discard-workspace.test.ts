import { describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";
import { ProjectSession } from "@main/session";

// An approved macOS window close discards the workspace while FotoReady stays running, so the
// next window starts empty and a later quit has nothing to ask about.

describe("discarding the workspace when its window closes", () => {
  it("empties the project at once, cancels descriptions, aborts saves and announces the empty workspace", async () => {
    let finishAbort!: () => void;
    const vision = { cancelAll: vi.fn(() => []) };
    const processing = {
      abortAll: vi.fn(() => new Promise<void>((resolve) => { finishAbort = resolve; })),
      snapshot: vi.fn(() => ({ total: 0, queued: 0, processing: 0, saved: 0, failed: 0, activeTaskId: null }))
    };
    const session = new ProjectSession({ ...defaultGlobalSettings(), defaultOutputDirectory: "/exports" }, vision as never, processing as never, null as never, "resources/stamps");
    const listener = vi.fn();
    session.setSnapshotListener(listener);
    const project = session.snapshot().project;
    project.originals.push(original());
    project.tasks.push(task());
    project.outputDir = "/elsewhere";
    session.selectTask("task-1");

    const discarding = session.discardWorkspace();

    expect(session.snapshot()).toMatchObject({ project: { originals: [], tasks: [], outputDir: "/exports" }, activeTaskId: null });
    expect(vision.cancelAll).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(processing.abortAll).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ project: expect.objectContaining({ tasks: [] }) }), expect.anything());
    finishAbort();
    await discarding;
    expect(() => session.selectTask("task-1")).toThrow("Task not found");
  });
});

function task(): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: "queued",
    output: null,
    error: null,
    everEdited: true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z"
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
    addedAt: "2026-10-06T00:00:00.000Z"
  };
}
