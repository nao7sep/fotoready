import path from "node:path";
import { nanoid } from "nanoid";
import type { Pipeline } from "@shared/types/pipeline";
import type { Original } from "@shared/types/project";
import type { OriginalThumbnail } from "@shared/types/ipc";
import type { WorkerJob, WorkerResult } from "@runtime/image";
import { PipelineError } from "@runtime/pipeline-error";
import type { AssetFolders } from "@main/asset-relink";
import type { TaskSidecarLoadResult } from "@main/task-sidecar";
import { saveCost } from "@main/queues/save-admission";
import { maximumPipelinePixels, type ImageSize } from "@shared/pipeline-geometry";
import { NativeProcessPool, type NativeLane } from "./native-pool";

export type NativeJob = WorkerJob
  | { kind: "original"; sourcePath: string; estimateQuality: boolean }
  | { kind: "thumbnail"; sourcePath: string; originalId: string; width: number; height: number; longEdge: number }
  | { kind: "sidecar"; sourcePath: string; bundledStampsDir: string; folders?: AssetFolders };
type NativeResult = WorkerResult | { kind: "original"; original: Original } | { kind: "thumbnail"; thumbnail: OriginalThumbnail } | { kind: "sidecar"; result: TaskSidecarLoadResult };

export class PipelineWorkerPool {
  #pool: NativeProcessPool;
  get backgroundCapacity(): number { return this.#pool.backgroundCapacity; }
  constructor(workerPoolSize: number) {
    this.#pool = new NativeProcessPool(path.join(import.meta.dirname, "workers/pipeline-process.js"), workerPoolSize);
  }

  async process(input: { sourcePath: string; pipeline: Pipeline; outputPath: string; signal?: AbortSignal; sourceSize?: ImageSize }): Promise<Extract<WorkerResult, { kind: "process" }>> {
    const pixels = maximumPipelinePixels(input.sourceSize ?? { width: 1, height: 1 }, input.pipeline.ops);
    // Native encoding and overlays can be substantially slower than a simple decode. Scale the
    // bound with maximum frame area and recipe length, keeping two minutes for small valid saves.
    const deadlineMs = 120_000 + Math.ceil(pixels / 1_000_000) * Math.max(1, input.pipeline.ops.length) * 2_000;
    const result = await this.run(() => ({ jobId: nanoid(), kind: "process", sourcePath: input.sourcePath,
      pipeline: input.pipeline, outputPath: input.outputPath, previewLongEdge: null }),
    { lane: "background", cost: saveCost(input.sourceSize?.width ?? 1, input.sourceSize?.height ?? 1, input.pipeline.ops), deadlineMs, queueMs: deadlineMs, signal: input.signal, outputPath: input.outputPath });
    if (result.kind !== "process") throw new Error("Worker returned a non-process result.");
    return result;
  }

  async renderBuffer(input: { sourcePath: string; pipeline: Pipeline; previewLongEdge: number | null; lane?: NativeLane }): Promise<Extract<WorkerResult, { kind: "preview" }>> {
    const result = await this.run(() => ({ jobId: nanoid(), kind: "preview", sourcePath: input.sourcePath,
      pipeline: input.pipeline, outputPath: null, previewLongEdge: input.previewLongEdge }),
    { lane: input.lane ?? "interactive", cost: (input.previewLongEdge ?? 4096) ** 2 * 16, deadlineMs: 60_000 });
    if (result.kind !== "preview") throw new Error("Worker returned a non-preview result.");
    return result;
  }

  async renderStage(input: { bitmap: Buffer; width: number; height: number; pipeline: Pipeline; lane?: NativeLane; signal?: AbortSignal }): Promise<Extract<WorkerResult, { kind: "preview" }>> {
    const result = await this.run(() => ({ jobId: nanoid(), kind: "preview-stage", bitmap: toArrayBuffer(input.bitmap), width: input.width,
      height: input.height, pipeline: input.pipeline }),
    { lane: input.lane ?? "interactive", cost: input.bitmap.byteLength * 4, deadlineMs: 60_000, signal: input.signal });
    if (result.kind !== "preview") throw new Error("Worker returned a non-preview result.");
    return result;
  }

  async prepareOriginal(sourcePath: string, estimateQuality: boolean): Promise<Original> {
    const result = await this.run(() => ({ kind: "original", sourcePath, estimateQuality }),
      { lane: "background", cost: 32 * 1024 * 1024, deadlineMs: 60_000 });
    if (result.kind !== "original") throw new Error("Worker returned a non-original result.");
    return result.original;
  }

  async renderOriginalThumbnail(original: Pick<Original, "id" | "sourcePath" | "width" | "height">, longEdge = 160): Promise<OriginalThumbnail> {
    const { id: originalId, sourcePath, width, height } = original;
    const result = await this.run(() => ({ kind: "thumbnail", sourcePath, originalId, width, height, longEdge }),
      { lane: "background", cost: saveCost(width, height), deadlineMs: 60_000 });
    if (result.kind !== "thumbnail") throw new Error("Worker returned a non-thumbnail result.");
    return result.thumbnail;
  }

  async prepareSidecar(sourcePath: string, bundledStampsDir: string, folders?: AssetFolders): Promise<TaskSidecarLoadResult> {
    const result = await this.run(() => ({ kind: "sidecar", sourcePath, bundledStampsDir, folders }),
      { lane: "background", cost: 1024 * 1024, deadlineMs: 30_000 });
    if (result.kind !== "sidecar") throw new Error("Worker returned a non-sidecar result.");
    return result.result;
  }

  destroy(): Promise<void> { return this.#pool.destroy(); }

  private async run(make: () => NativeJob, options: Parameters<NativeProcessPool["run"]>[1]): Promise<NativeResult> {
    const result = await this.#pool.run<NativeResult>(make, options);
    if (result.kind === "error") {
      const error = new PipelineError(result.category, result.message);
      if (result.stack) error.stack = result.stack;
      if ("code" in result) Object.assign(error, { code: result.code });
      throw error;
    }
    return result;
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
