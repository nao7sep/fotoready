import sharp from "sharp";
import type { OpInstance } from "@shared/types/op";
import type { Pipeline } from "@shared/types/pipeline";
import type { Original, Project, Task } from "@shared/types/project";
import type { LutEntry, LutPreviewEntry, OriginalThumbnail, PreviewRenderOptions, PreviewResult } from "@shared/types/ipc";
import { getOpModule } from "@core/ops/catalog";
import { loadCubeLut } from "@adapters/cube-loader";
import { runPipeline, runPipelineFromRaw } from "@runtime/pipeline-runner";
import { MAX_INPUT_PIXELS } from "@runtime/decode";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";

type PreviewBitmap = {
  data: Buffer;
  width: number;
  height: number;
};

type BasePreviewEntry = PreviewBitmap & {
  key: string;
};

type TaskPreviewCache = {
  base: BasePreviewEntry | null;
  stages: Map<number, PreviewBitmap>;
};

export class PreviewService {
  #tasks = new Map<string, TaskPreviewCache>();

  constructor(private readonly workerPool: PipelineWorkerPool | null) {}

  invalidateTask(taskId: string): void {
    this.#tasks.delete(taskId);
  }

  invalidateTaskFrom(taskId: string, opIndex: number): void {
    const cache = this.#tasks.get(taskId);
    if (!cache) return;
    for (const stageIndex of cache.stages.keys()) {
      if (stageIndex >= opIndex) {
        cache.stages.delete(stageIndex);
      }
    }
  }

  async renderTaskPreview(
    project: Project,
    taskId: string,
    previewLongEdge: number,
    options?: PreviewRenderOptions
  ): Promise<PreviewResult> {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const original = project.originals.find((item) => item.id === task.originalId);
    if (!original) {
      throw new Error(`Original not found for task: ${taskId}`);
    }

    const targetStageIndex = previewTargetStageIndex(task, options);
    const bitmap = await this.renderStage(original, task, previewLongEdge, targetStageIndex);
    const png = await sharp(bitmap.data, {
      raw: {
        width: bitmap.width,
        height: bitmap.height,
        channels: 4
      }
    }).png().toBuffer();

    return {
      taskId,
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      width: bitmap.width,
      height: bitmap.height
    };
  }

  async renderOriginalThumbnail(original: Original, longEdge = 160): Promise<OriginalThumbnail> {
    const image = sharp(original.sourcePath, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
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

  async renderLutPreviews(
    project: Project,
    taskId: string,
    luts: LutEntry[],
    previewLongEdge: number,
    options: PreviewRenderOptions | undefined,
    strength: number
  ): Promise<LutPreviewEntry[]> {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const original = project.originals.find((item) => item.id === task.originalId);
    if (!original) {
      throw new Error(`Original not found for task: ${taskId}`);
    }

    const base = await resizePreviewBitmap(
      await this.renderStage(original, task, previewLongEdge, previewTargetStageIndex(task, options)),
      previewLongEdge
    );
    const opPipeline: Pipeline = {
      ...task.pipeline,
      ops: []
    };
    const previews: LutPreviewEntry[] = [];
    for (const lut of luts) {
      const result = await runPipelineFromRaw(
        {
          ...opPipeline,
          ops: [{
            id: `lut-preview:${lut.path}`,
            type: "lut",
            enabled: true,
            params: {
              cubePath: lut.path,
              strength
            }
          }]
        },
        { bytes: Buffer.from(base.data), width: base.width, height: base.height },
        { resolveLut: loadCubeLut }
      );
      const png = await sharp(result.bytes, {
        raw: {
          width: result.width,
          height: result.height,
          channels: 4
        }
      }).png().toBuffer();
      previews.push({
        ...lut,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        width: result.width,
        height: result.height
      });
    }
    return previews;
  }

  private async renderStage(original: Original, task: Task, previewLongEdge: number, targetStageIndex: number): Promise<PreviewBitmap> {
    const cache = this.taskCache(task.id);
    const base = await this.previewBase(cache, original, task.pipeline, previewLongEdge);
    if (targetStageIndex < 0) return base;

    let currentIndex = -1;
    let current: PreviewBitmap = base;
    for (const [stageIndex, stage] of cache.stages) {
      if (stageIndex <= targetStageIndex && stageIndex > currentIndex) {
        currentIndex = stageIndex;
        current = stage;
      }
    }

    for (let opIndex = currentIndex + 1; opIndex <= targetStageIndex; opIndex += 1) {
      const op = task.pipeline.ops[opIndex];
      if (!op) break;
      current = await this.renderOpStage(current, op, task.pipeline);
      cache.stages.set(opIndex, current);
    }

    return current;
  }

  private taskCache(taskId: string): TaskPreviewCache {
    const existing = this.#tasks.get(taskId);
    if (existing) return existing;
    const cache: TaskPreviewCache = { base: null, stages: new Map() };
    this.#tasks.set(taskId, cache);
    return cache;
  }

  private async previewBase(cache: TaskPreviewCache, original: Original, pipeline: Pipeline, previewLongEdge: number): Promise<BasePreviewEntry> {
    const key = `${original.id}:${original.sourceHash}:${previewLongEdge}`;
    if (cache.base?.key === key) {
      return cache.base;
    }

    cache.stages.clear();
    const basePipeline: Pipeline = { ...pipeline, ops: [] };
    const result = this.workerPool
      ? await this.workerPool.renderBuffer({
        sourcePath: original.sourcePath,
        pipeline: basePipeline,
        previewLongEdge
      })
      : await runPipeline(basePipeline, {
        sourcePath: original.sourcePath,
        previewLongEdge,
        resolveLut: loadCubeLut
      });

    if (result.kind !== "buffer" && result.kind !== "preview") {
      throw new Error("Preview base render did not produce a buffer.");
    }

    const base: BasePreviewEntry = {
      key,
      data: result.kind === "preview" ? Buffer.from(result.bitmap) : result.bytes,
      width: result.width,
      height: result.height
    };
    cache.base = base;
    return base;
  }

  private async renderOpStage(previous: PreviewBitmap, op: OpInstance, pipeline: Pipeline): Promise<PreviewBitmap> {
    const module = getOpModule(op.type);
    if (!op.enabled || !module || module.metadataOnly || !module.apply) {
      return previous;
    }

    const opPipeline: Pipeline = { ...pipeline, ops: [op] };
    const result = this.workerPool
      ? await this.workerPool.renderStage({
        bitmap: previous.data,
        width: previous.width,
        height: previous.height,
        pipeline: opPipeline
      })
      : await runPipelineFromRaw(
        opPipeline,
        { bytes: previous.data, width: previous.width, height: previous.height },
        { resolveLut: loadCubeLut }
      );

    if (result.kind !== "buffer" && result.kind !== "preview") {
      throw new Error("Preview stage render did not produce a buffer.");
    }

    return {
      data: result.kind === "preview" ? Buffer.from(result.bitmap) : result.bytes,
      width: result.width,
      height: result.height
    };
  }
}

async function resizePreviewBitmap(bitmap: PreviewBitmap, longEdge: number): Promise<PreviewBitmap> {
  const targetLongEdge = Math.max(1, Math.round(longEdge));
  if (Math.max(bitmap.width, bitmap.height) === targetLongEdge) {
    return bitmap;
  }

  const { data, info } = await sharp(bitmap.data, {
    raw: {
      width: bitmap.width,
      height: bitmap.height,
      channels: 4
    }
  })
    .resize({ width: targetLongEdge, height: targetLongEdge, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height
  };
}

function previewTargetStageIndex(task: Task, options?: PreviewRenderOptions): number {
  const mode = options?.mode ?? "full";
  const targetOpId = options?.targetOpId ?? null;
  if (mode === "full") {
    return task.pipeline.ops.length - 1;
  }

  if (!targetOpId) {
    throw new Error(`Preview mode "${mode}" requires a target op id.`);
  }

  const opIndex = task.pipeline.ops.findIndex((op) => op.id === targetOpId);
  if (opIndex === -1) {
    throw new Error(`Preview target op not found: ${targetOpId}`);
  }

  return mode === "input" ? opIndex - 1 : opIndex;
}
