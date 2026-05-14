import sharp from "sharp";
import type { Original, Project, Task } from "@shared/types/project";
import type { Pipeline } from "@shared/types/pipeline";
import { runPipeline } from "@runtime/pipeline-runner";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { loadCubeLut } from "@adapters/lut/cube-loader";

export type PreviewResult = {
  taskId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type OriginalThumbnail = {
  originalId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export async function renderOriginalThumbnail(original: Original, longEdge = 160): Promise<OriginalThumbnail> {
  const image = sharp(original.sourcePath, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  const bytes = await image
    .resize({ width: longEdge, height: longEdge, fit: "cover" })
    .jpeg({ quality: 72 })
    .toBuffer();

  return {
    originalId: original.id,
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    width: metadata.width ?? original.width,
    height: metadata.height ?? original.height
  };
}

export async function renderTaskPreview(
  project: Project,
  taskId: string,
  previewLongEdge: number,
  workerPool?: PipelineWorkerPool | null,
  options?: { truncateOpsAt?: number | null }
): Promise<PreviewResult> {
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = project.originals.find((item) => item.id === task.originalId);
  if (!original) {
    throw new Error(`Original not found for task: ${taskId}`);
  }

  const previewPipeline = pipelineForPreview(task, options);

  const result = workerPool
    ? await workerPool.renderBuffer({
      sourcePath: original.sourcePath,
      sourceHash: original.sourceHash,
      pipeline: previewPipeline,
      previewLongEdge
    })
    : await runPipeline(previewPipeline, {
      sourcePath: original.sourcePath,
      sourceHash: original.sourceHash,
      previewLongEdge,
      resolveLut: loadCubeLut
    });

  if (result.kind !== "buffer" && result.kind !== "preview") {
    throw new Error("Preview render did not produce a buffer.");
  }

  const raw = result.kind === "preview" ? Buffer.from(result.bitmap) : result.bytes;
  const png = await sharp(raw, {
    raw: {
      width: result.width,
      height: result.height,
      channels: 4
    }
  }).png().toBuffer();

  return {
    taskId,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width: result.width,
    height: result.height
  };
}

function pipelineForPreview(task: Task, options?: { truncateOpsAt?: number | null }): Pipeline {
  const truncateOpsAt = options?.truncateOpsAt;
  if (truncateOpsAt === null || truncateOpsAt === undefined) {
    return task.pipeline;
  }
  return {
    ...task.pipeline,
    ops: task.pipeline.ops.slice(0, truncateOpsAt)
  };
}
