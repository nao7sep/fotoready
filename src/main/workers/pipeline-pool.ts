import path from "node:path";
import { fileURLToPath } from "node:url";
import Piscina from "piscina";
import { nanoid } from "nanoid";
import type { Pipeline } from "@shared/types/pipeline";
import type { WorkerJob, WorkerResult } from "@runtime/image";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PipelineWorkerPool {
  #pool: Piscina;

  constructor(workerPoolSize: number) {
    this.#pool = new Piscina({
      filename: path.join(__dirname, "workers/pipeline-worker.js"),
      maxThreads: Math.max(1, workerPoolSize)
    });
  }

  async process(input: {
    sourcePath: string;
    pipeline: Pipeline;
    outputPath: string;
  }): Promise<Extract<WorkerResult, { kind: "process" }>> {
    const result = await this.run({
      jobId: nanoid(),
      kind: "process",
      sourcePath: input.sourcePath,
      pipeline: input.pipeline,
      outputPath: input.outputPath,
      previewLongEdge: null
    });
    if (result.kind !== "process") throw new Error("Worker returned a non-process result.");
    return result;
  }

  async renderBuffer(input: {
    sourcePath: string;
    pipeline: Pipeline;
    previewLongEdge: number | null;
  }): Promise<Extract<WorkerResult, { kind: "preview" }>> {
    const result = await this.run({
      jobId: nanoid(),
      kind: "preview",
      sourcePath: input.sourcePath,
      pipeline: input.pipeline,
      outputPath: null,
      previewLongEdge: input.previewLongEdge
    });
    if (result.kind !== "preview") throw new Error("Worker returned a non-preview result.");
    return result;
  }

  async renderStage(input: {
    bitmap: Buffer;
    width: number;
    height: number;
    pipeline: Pipeline;
  }): Promise<Extract<WorkerResult, { kind: "preview" }>> {
    const result = await this.run({
      jobId: nanoid(),
      kind: "preview-stage",
      bitmap: toArrayBuffer(input.bitmap),
      width: input.width,
      height: input.height,
      pipeline: input.pipeline
    });
    if (result.kind !== "preview") throw new Error("Worker returned a non-preview result.");
    return result;
  }

  async destroy(): Promise<void> {
    await this.#pool.destroy();
  }

  private async run(job: WorkerJob): Promise<WorkerResult> {
    return this.#pool.run(job) as Promise<WorkerResult>;
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
