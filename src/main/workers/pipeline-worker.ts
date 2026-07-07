import { loadCubeLut } from "@adapters/cube-loader";
import type { WorkerJob, WorkerResult } from "@runtime/image";
import { runPipeline, runPipelineFromRaw } from "@runtime/pipeline-runner";
import { asPipelineError } from "@runtime/pipeline-error";

export default async function pipelineWorker(job: WorkerJob): Promise<WorkerResult> {
  try {
    return await runJob(job);
  } catch (error) {
    // Return the failure as a categorized value. Throwing here would cross the
    // worker boundary as a message-only error, losing the category the main process
    // needs to decide whether the task is worth retrying.
    const pipelineError = asPipelineError(error, "unknown");
    return {
      kind: "error",
      category: pipelineError.category,
      message: pipelineError.message,
      stack: pipelineError.stack ?? null
    };
  }
}

async function runJob(job: WorkerJob): Promise<WorkerResult> {
  if (job.kind === "preview-stage") {
    const result = await runPipelineFromRaw(
      job.pipeline,
      { bytes: Buffer.from(job.bitmap), width: job.width, height: job.height },
      { resolveLut: loadCubeLut }
    );
    return {
      kind: "preview",
      bitmap: toArrayBuffer(result.bytes),
      width: result.width,
      height: result.height,
      format: "rgba8",
      appliedPipeline: result.appliedPipeline
    };
  }

  const result = await runPipeline(job.pipeline, {
    sourcePath: job.sourcePath,
    outputPath: job.outputPath ?? undefined,
    previewLongEdge: job.kind === "preview" ? job.previewLongEdge ?? undefined : undefined,
    resolveLut: loadCubeLut
  });

  if (job.kind === "process") {
    if (result.kind !== "file") {
      throw new Error("Processing job did not produce a file result.");
    }
    return {
      kind: "process",
      outputPath: result.outputPath,
      outputHash: result.outputHash,
      bytes: result.bytes,
      appliedPipeline: result.appliedPipeline
    };
  }

  if (result.kind !== "buffer") {
    throw new Error("Preview job did not produce a buffer result.");
  }
  return {
    kind: "preview",
    bitmap: toArrayBuffer(result.bytes),
    width: result.width,
    height: result.height,
    format: "rgba8",
    appliedPipeline: result.appliedPipeline
  };
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
