import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewService } from "@main/preview-service";
import { PipelineWorkerPool, type NativeJob } from "@main/workers/pipeline-pool";
import type { Original } from "@shared/types/project";
import type { OriginalThumbnail } from "@shared/types/ipc";

const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@main/workers/native-pool", () => ({ NativeProcessPool: class {
  run = native.run;
} }));

let directory: string;
let handleMessage: (job: NativeJob) => void;
beforeAll(async () => {
  // Capture the actual child IPC handler without leaving process listeners installed in the runner.
  const messages = new Set(process.listeners("message"));
  const disconnects = new Set(process.listeners("disconnect"));
  vi.stubEnv("FOTOREADY_TEXT_CACHE_BYTES", "1048576");
  try {
    await import("@main/workers/pipeline-process");
    for (const listener of process.listeners("message")) {
      if (!messages.has(listener)) {
        handleMessage = listener as (job: NativeJob) => void;
        process.removeListener("message", listener);
      }
    }
    for (const listener of process.listeners("disconnect")) {
      if (!disconnects.has(listener)) process.removeListener("disconnect", listener);
    }
  } finally { vi.unstubAllEnvs(); }
});
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-thumbnail-"));
  native.run.mockReset();
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function original(sourcePath: string): Original {
  return { id: "original-1", sourcePath, sourceHash: "hash", size: 1, format: "jpeg", jpegQualityEstimate: null,
    width: 16, height: 32, addedAt: "2026-10-23T00:00:00.000Z", metadataSummary: { editorial: {}, dates: {}, gps: {} } };
}

async function dispatch(job: NativeJob): Promise<{ kind: string; thumbnail?: OriginalThumbnail; category?: string }> {
  const previous = process.send;
  const result = vi.fn();
  process.send = ((...args: unknown[]) => {
    const message = args[0] as { kind?: string };
    if (message?.kind === "thumbnail" || message?.kind === "error") {
      result(message);
      return true;
    }
    return previous ? Reflect.apply(previous, process, args) : false;
  }) as typeof process.send;
  try {
    handleMessage(job);
    await vi.waitFor(() => expect(result).toHaveBeenCalledOnce());
    return result.mock.calls[0]![0];
  } finally { process.send = previous; }
}

describe("original thumbnail worker ownership", () => {
  it("dispatches a lazy background thumbnail with source-sized accounting and a native deadline", async () => {
    const thumbnail = { originalId: "original-1", dataUrl: "data:image/jpeg;base64,pixels", width: 32, height: 16 };
    native.run.mockResolvedValue({ kind: "thumbnail", thumbnail });
    const pool = new PipelineWorkerPool(2);
    const source = original("/source/photo.jpg");
    const work = pool.renderOriginalThumbnail(source, 48);
    const [make, options] = native.run.mock.calls[0]!;
    expect(typeof make).toBe("function");
    expect(options).toMatchObject({ lane: "background", cost: 16 * 32 * 32, deadlineMs: 60_000 });
    source.sourcePath = "/source/replaced.jpg";
    expect(make()).toEqual({ kind: "thumbnail", sourcePath: "/source/photo.jpg", originalId: source.id, width: 16, height: 32, longEdge: 48 });
    await expect(work).resolves.toBe(thumbnail);
  });

  it("uses the production pool directly without opening the source in the main process", async () => {
    const thumbnail = { originalId: "original-1", dataUrl: "data:image/jpeg;base64,pixels", width: 32, height: 16 };
    const renderOriginalThumbnail = vi.fn(async () => thumbnail);
    const pool = { renderOriginalThumbnail } as unknown as PipelineWorkerPool;
    const source = original(path.join(directory, "does-not-exist.jpg"));
    await expect(new PreviewService(pool).renderOriginalThumbnail(source, 48)).resolves.toBe(thumbnail);
    expect(renderOriginalThumbnail).toHaveBeenCalledWith(source, 48);
  });

  it("renders the child IPC thumbnail with the existing rotation, cover crop, JPEG quality and dimensions", async () => {
    const sourcePath = path.join(directory, "oriented.jpg");
    const blue = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#0000ff" } }).png().toBuffer();
    await sharp({ create: { width: 32, height: 16, channels: 3, background: "#ff0000" } })
      .composite([{ input: blue, left: 16, top: 0 }]).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toFile(sourcePath);
    const source = original(sourcePath);
    const result = await dispatch({ kind: "thumbnail", sourcePath, originalId: source.id, width: source.width, height: source.height, longEdge: 20 });
    expect(result.kind).toBe("thumbnail");
    const thumbnail = result.thumbnail!;
    expect(thumbnail).toMatchObject({ originalId: source.id, width: 32, height: 16 });
    const encoded = Buffer.from(thumbnail.dataUrl.split(",")[1]!, "base64");
    expect(await sharp(encoded).metadata()).toMatchObject({ format: "jpeg", width: 20, height: 20 });
    const expected = await sharp(sourcePath, { limitInputPixels: false }).rotate().resize({ width: 20, height: 20, fit: "cover" }).jpeg({ quality: 72 }).toBuffer();
    expect(encoded).toEqual(expected);
    await expect(new PreviewService(null).renderOriginalThumbnail(source, 20)).resolves.toEqual(thumbnail);
  });

  it("returns source decoding failures through the child error result", async () => {
    const result = await dispatch({ kind: "thumbnail", sourcePath: path.join(directory, "missing.jpg"), originalId: "missing", width: 1, height: 1, longEdge: 20 });
    expect(result).toMatchObject({ kind: "error", category: "io" });
  });
});
