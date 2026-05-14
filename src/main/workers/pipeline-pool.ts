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
    sourceHash: string;
    pipeline: Pipeline;
    outputPath: string;
  }): Promise<Extract<WorkerResult, { kind: "process" }>> {
    const result = await this.run({
      jobId: nanoid(),
      kind: "process",
      sourcePath: input.sourcePath,
      sourceHash: input.sourceHash,
      pipeline: input.pipeline,
      outputPath: input.outputPath,
      previewLongEdge: null
    });
    if (result.kind !== "process") throw new Error("Worker returned a non-process result.");
    return result;
  }

  async renderBuffer(input: {
    sourcePath: string;
    sourceHash: string;
    pipeline: Pipeline;
    previewLongEdge: number | null;
  }): Promise<Extract<WorkerResult, { kind: "preview" }>> {
    const result = await this.run({
      jobId: nanoid(),
      kind: "preview",
      sourcePath: input.sourcePath,
      sourceHash: input.sourceHash,
      pipeline: input.pipeline,
      outputPath: null,
      previewLongEdge: input.previewLongEdge
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
