import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const metadata = vi.hoisted(() => ({ hold: null as Promise<void> | null, started: vi.fn() }));
vi.mock("@adapters/exiftool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/exiftool")>();
  return {
    ...actual,
    readSourceMetadataSummary: async (...args: Parameters<typeof actual.readSourceMetadataSummary>) => {
      metadata.started(args[0]);
      if (metadata.hold) await metadata.hold;
      return { editorial: {}, dates: {}, gps: {} };
    }
  };
});

import { ProjectSession } from "@main/session";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import type { Project, Task, TaskStatus } from "@shared/types/project";
import type { OriginalImportIssue } from "@shared/types/ipc";

const time = "2026-10-23T00:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  metadata.hold = null;
  metadata.started.mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function photos(...colors: string[]): Promise<string[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-batch-"));
  roots.push(root);
  return Promise.all(colors.map(async (background, index) => {
    const filePath = path.join(root, `photo-${index}.png`);
    await sharp({ create: { width: 4, height: 4, channels: 3, background } }).png().toFile(filePath);
    return filePath;
  }));
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
  const session = new ProjectSession(defaultGlobalSettings(), vision as never, processing as never, null as never, "resources/stamps");
  return { session, processing, vision };
}

describe("session batch snapshot ownership", () => {
  it("builds one returned snapshot for a partially successful import and preserves the last successful selection", async () => {
    const { session } = arrange();
    const [first, last] = await photos("teal", "orange");
    const failedPath = path.join(path.dirname(first!), "missing.png");
    const initialIssue: OriginalImportIssue = {
      filePath: "/photos/unsupported.txt", kind: "unsupported", severity: "warning", reason: { key: "importReason.unsupported" }
    };
    const snapshot = vi.spyOn(session, "snapshot");

    const result = await session.addOriginals([first!, failedPath, last!], [initialIssue]);

    expect(snapshot).toHaveBeenCalledOnce();
    expect(result.snapshot).toBe(snapshot.mock.results[0]!.value);
    expect(result).toMatchObject({ acceptedImages: 2, addedOriginals: 2, restoredTasks: 0, succeededPaths: [first, last] });
    const originals = result.snapshot.project.originals;
    expect(originals.map((image) => image.sourcePath)).toEqual([first, last]);
    const active = result.snapshot.project.tasks.find((item) => item.id === result.snapshot.activeTaskId);
    expect(active!.originalId).toBe(originals[1]!.id);
    expect(result.issues).toEqual([initialIssue, {
      filePath: failedPath, kind: "failed", severity: "error", reason: { key: "importReason.imageUnreadable" }
    }]);
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
    const { session, processing, vision } = arrange();
    const [late, later] = await photos("teal", "orange");
    const preparing = deferred<void>();
    const started = deferred<void>();
    metadata.hold = preparing.promise;
    metadata.started.mockImplementationOnce(() => started.resolve());
    const importing = session.addOriginals([late!, later!]);
    await started.promise;

    await session.shutdown();
    preparing.resolve();
    const result = await importing;

    expect(processing.shutdown).toHaveBeenCalledOnce();
    expect(vision.shutdown).toHaveBeenCalledOnce();
    expect(metadata.started).toHaveBeenCalledExactlyOnceWith(late);
    expect(result).toMatchObject({ acceptedImages: 0, addedOriginals: 0, restoredTasks: 0, succeededPaths: [] });
    expect(result.snapshot.project.originals).toEqual([]);
    expect(result.snapshot.project.tasks).toEqual([]);
    expect(result.snapshot.activeTaskId).toBeNull();
  });
});
