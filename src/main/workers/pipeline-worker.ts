import { parentPort } from "node:worker_threads";
import { loadCubeLut } from "@adapters/cube-loader";
import type { WorkerJob, WorkerResult } from "@runtime/image";
import { runPipeline } from "@runtime/pipeline-runner";

export default async function pipelineWorker(job: WorkerJob): Promise<WorkerResult> {
  const result = await runPipeline(job.pipeline, {
    sourcePath: job.sourcePath,
    sourceHash: job.sourceHash,
    outputPath: job.outputPath ?? undefined,
    previewLongEdge: job.kind === "preview" ? job.previewLongEdge ?? undefined : undefined,
    log: (message, extra) => parentPort?.postMessage({ jobId: job.jobId, message, extra }),
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
