import { describe, expect, it, vi } from "vitest";
import { ProjectSession } from "@main/session";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Project, Task, TaskStatus } from "@shared/types/project";
import type { OriginalImportIssue } from "@shared/types/ipc";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";

const time = "2026-10-23T00:00:00.000Z";

function original(id: string): Original {
  return {
    id, sourcePath: `/photos/${id}.png`, sourceHash: `hash-${id}`, size: 64, format: "png",
    jpegQualityEstimate: null, metadataSummary: { editorial: {}, dates: {}, gps: {} }, width: 4, height: 4, addedAt: time
  };
}

function task(id: string, status: TaskStatus): Task {
  return {
    id, originalId: "original-1", generateDescription: false, generateSlug: false, customSlug: null,
    visionRunning: false, visionRunMode: null, pipeline: defaultPipeline(), status, output: null, error: null,
    everEdited: false, createdAt: time, updatedAt: time
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function arrange() {
  const processing = {
    enqueueTask: vi.fn<(project: Project, taskId: string) => Promise<void>>(async () => undefined),
    shutdown: vi.fn(async () => undefined)
  };
  const vision = { shutdown: vi.fn(async () => undefined) };
  const prepareOriginal = vi.fn<PipelineWorkerPool["prepareOriginal"]>();
  const prepareSidecar = vi.fn<PipelineWorkerPool["prepareSidecar"]>();
  const session = new ProjectSession(defaultGlobalSettings(), vision as never, processing as never,
    { prepareOriginal, prepareSidecar } as unknown as PipelineWorkerPool, "resources/stamps");
  return { session, processing, vision, prepareOriginal, prepareSidecar };
}

describe("session batch snapshot ownership", () => {
  it("builds one returned snapshot for a partially successful import and preserves the last successful selection", async () => {
    const { session, prepareOriginal } = arrange();
    const first = original("first");
    const last = original("last");
    const failedPath = "/photos/missing.png";
    prepareOriginal.mockResolvedValueOnce(first)
      .mockRejectedValueOnce(Object.assign(new Error("missing source"), { code: "ENOENT" }))
      .mockResolvedValueOnce(last);
    const initialIssue: OriginalImportIssue = {
      filePath: "/photos/unsupported.txt", kind: "unsupported", severity: "warning", reason: { key: "importReason.unsupported" }
    };
    const snapshot = vi.spyOn(session, "snapshot");

    const result = await session.addOriginals([first.sourcePath, failedPath, last.sourcePath], [initialIssue]);

    expect(snapshot).toHaveBeenCalledOnce();
    expect(result.snapshot).toBe(snapshot.mock.results[0]!.value);
    expect(result).toMatchObject({ acceptedImages: 2, addedOriginals: 2, restoredTasks: 0, succeededPaths: [first.sourcePath, last.sourcePath] });
    expect(result.snapshot.project.originals.map((image) => image.id)).toEqual([first.id, last.id]);
    const active = result.snapshot.project.tasks.find((item) => item.id === result.snapshot.activeTaskId);
    expect(active!.originalId).toBe(last.id);
    expect(result.issues).toEqual([initialIssue, {
      filePath: failedPath, kind: "failed", severity: "error", reason: { key: "importReason.imageUnreadable" }
    }]);
    expect(prepareOriginal.mock.calls.map(([sourcePath]) => sourcePath)).toEqual([first.sourcePath, failedPath, last.sourcePath]);
  });

  it("queues every eligible task and builds only the returned Save All snapshot", () => {
    const { session, processing } = arrange();
    const tasks = [task("first", "not-saved"), task("saved", "saved"), task("last", "not-saved"), task("queued", "queued"), task("failed", "error")];
    session.project().tasks.push(...tasks);
    const snapshot = vi.spyOn(session, "snapshot");

    const result = session.enqueueSaveAll();

    expect(snapshot).toHaveBeenCalledOnce();
    expect(result).toBe(snapshot.mock.results[0]!.value);
    expect(processing.enqueueTask.mock.calls.map(([, taskId]) => taskId)).toEqual(["first", "last"]);
    expect(result.project.tasks.map((item) => item.status)).toEqual(["queued", "saved", "queued", "queued", "error"]);
  });

  it("discards an image preparation that settles after shutdown and never prepares later files", async () => {
    const { session, processing, vision, prepareOriginal } = arrange();
    const started = deferred<void>();
    const preparing = deferred<Original>();
    prepareOriginal.mockImplementationOnce(() => { started.resolve(); return preparing.promise; });
    const importing = session.addOriginals(["/photos/late.png", "/photos/later.png"]);
    await started.promise;

    await session.shutdown();
    preparing.resolve(original("late"));
    const result = await importing;

    expect(processing.shutdown).toHaveBeenCalledOnce();
    expect(vision.shutdown).toHaveBeenCalledOnce();
    expect(prepareOriginal).toHaveBeenCalledOnce();
    expect(prepareOriginal).toHaveBeenCalledWith("/photos/late.png", defaultGlobalSettings().enableJpegQualityEstimate);
    expect(result).toMatchObject({ acceptedImages: 0, addedOriginals: 0, restoredTasks: 0, succeededPaths: [] });
    expect(result.snapshot.project.originals).toEqual([]);
    expect(result.snapshot.project.tasks).toEqual([]);
    expect(result.snapshot.activeTaskId).toBeNull();
  });
});
