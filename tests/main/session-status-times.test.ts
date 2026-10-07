import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Original, Task, TaskStatus } from "@shared/types/project";
import type { ProcessingQueue } from "@main/queues/processing-queue";
import type { VisionQueue } from "@main/queues/vision";
import { ProjectSession } from "@main/session";

/**
 * A task's modified time (`updatedAt`) moves only with an edit. Queueing, cancelling, retrying,
 * dismissing an error and deleting the saved output change its status, never that time.
 */

const MODIFIED = "2026-09-20T00:00:00.000Z";

describe("ProjectSession status changes", () => {
  it("leave the modified time when a save is queued and cancelled", () => {
    const { session, task } = arrange("not-saved");

    session.enqueueSave(task.id);
    expect(task.status).toBe("queued");
    session.cancelTask(task.id);
    expect(task.status).toBe("not-saved");
    session.enqueueSaveAll();
    session.cancelAll();

    expect(task.status).toBe("not-saved");
    expect(task.updatedAt).toBe(MODIFIED);
  });

  it("leave the modified time when an error is dismissed or retried", async () => {
    const dismissed = arrange("error");
    dismissed.session.dismissTaskError(dismissed.task.id);
    expect(dismissed.task.status).toBe("not-saved");
    expect(dismissed.task.updatedAt).toBe(MODIFIED);

    const retried = arrange("error");
    await retried.session.retryTask(retried.task.id);
    expect(retried.task.status).toBe("queued");
    expect(retried.task.updatedAt).toBe(MODIFIED);
  });

  it("leave the modified time when the saved output is deleted", async () => {
    const { session, task } = arrange("saved");

    await session.deleteSavedOutput(task.id);

    expect(task.status).toBe("not-saved");
    expect(task.output).toBeNull();
    expect(task.updatedAt).toBe(MODIFIED);
  });
  it("leaves task state and output files unchanged when a newer sidecar refuses deletion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-session-delete-"));
    try {
      const { session, task } = arrange("saved");
      task.output!.stagedPath = path.join(root, "photo.jpg");
      task.output!.stagedParamsPath = path.join(root, "photo.json");
      await fs.writeFile(task.output!.stagedPath, "photo bytes");
      await fs.writeFile(task.output!.stagedParamsPath, '{"formatVersion":2,"future":"preserved"}');
      const before = structuredClone(task);
      await expect(session.deleteSavedOutput(task.id)).rejects.toMatchObject({ reason: { key: "failure.outputSidecarNewer" } });
      expect(task).toEqual(before);
      expect(await fs.readFile(task.output!.stagedPath, "utf8")).toBe("photo bytes");
      expect(await fs.readFile(task.output!.stagedParamsPath, "utf8")).toBe('{"formatVersion":2,"future":"preserved"}');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

});

function arrange(status: TaskStatus): { session: ProjectSession; task: Task } {
  const processingQueue = {
    enqueueTask: vi.fn(async () => undefined),
    cancelTask: vi.fn(),
    cancelAll: vi.fn(() => [])
  } as unknown as ProcessingQueue;
  const visionQueue = { cancelTask: vi.fn(), cancelAll: vi.fn(() => []) } as unknown as VisionQueue;
  const session = new ProjectSession(defaultGlobalSettings(), visionQueue, processingQueue, null as never, "resources/stamps");
  const task = taskWith(status);
  const project = session.snapshot().project;
  project.originals.push(original());
  project.tasks.push(task);
  return { session, task };
}

function taskWith(status: TaskStatus): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status,
    output: status === "saved"
      ? {
        stagedPath: "/missing-output/photo.jpg",
        stagedParamsPath: "/missing-output/photo-fotoready.json",
        stagedAt: "2026-09-21T00:00:00.000Z",
        outputHash: "output-hash",
        vision: null,
        finalPath: null,
        finalParamsPath: null,
        renamedAt: null
      }
      : null,
    error: status === "error"
      ? { stage: "processing", message: { key: "processingError.generic" }, detail: null, occurredAt: "2026-09-21T00:00:00.000Z", retryable: true }
      : null,
    everEdited: true,
    createdAt: MODIFIED,
    updatedAt: MODIFIED
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
    addedAt: MODIFIED
  };
}
