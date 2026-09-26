import { createHash } from "node:crypto";
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

/**
 * One task's cached preview chain. Each stage is keyed by the content that produced it — the base key
 * and every op up to and including it — so a render that finishes after a newer edit lands under a key
 * no current request asks for, instead of standing in for the edited stage.
 */
type TaskPreviewCache = {
  base: BasePreviewEntry | null;
  stages: Map<string, PreviewBitmap>;
};

/**
 * Bitmaps kept for tasks other than the one being previewed. At the default 1024px preview a stage is
 * about 3 MB, so this holds a few recently viewed tasks' chains; the task being previewed always keeps
 * its own chain whatever its size.
 */
const DEFAULT_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

export class PreviewService {
  // Least recently previewed first: a render moves its task to the end.
  #tasks = new Map<string, TaskPreviewCache>();
  readonly #budgetBytes: number;

  constructor(private readonly workerPool: PipelineWorkerPool | null, options: { budgetBytes?: number } = {}) {
    this.#budgetBytes = options.budgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES;
  }

  invalidateTask(taskId: string): void {
    this.#tasks.delete(taskId);
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
    // Each LUT renders on the worker pool like any op stage, so parsing a large .cube and the per-pixel
    // lookup never run on the main process, and several LUTs render at once.
    return Promise.all(luts.map(async (lut): Promise<LutPreviewEntry> => {
      const op: OpInstance = {
        id: `lut-preview:${lut.path}`,
        type: "lut",
        enabled: true,
        params: { cubePath: lut.path, strength }
      };
      const result = await this.renderOpStage(base, op, task.pipeline);
      const png = await sharp(result.data, {
        raw: {
          width: result.width,
          height: result.height,
          channels: 4
        }
      }).png().toBuffer();
      return {
        ...lut,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        width: result.width,
        height: result.height
      };
    }));
  }

  private async renderStage(original: Original, task: Task, previewLongEdge: number, targetStageIndex: number): Promise<PreviewBitmap> {
    // The task can be edited while this render awaits; everything it renders comes from this snapshot.
    // Copying the array is enough because the session replaces an edited op rather than mutating it.
    const pipeline: Pipeline = { ...task.pipeline, ops: [...task.pipeline.ops] };
    const baseKey = previewBaseKey(original, previewLongEdge);
    const stageKeys = previewStageKeys(baseKey, pipeline.ops);
    const cache = this.taskCache(task.id);
    // Only the current chain is worth keeping; stages of superseded edits go now.
    const current = new Set(stageKeys);
    for (const key of cache.stages.keys()) {
      if (!current.has(key)) cache.stages.delete(key);
    }

    const result = await this.renderChain(cache, original, pipeline, baseKey, stageKeys, previewLongEdge, targetStageIndex);
    this.enforceBudget(task.id);
    return result;
  }

  private async renderChain(
    cache: TaskPreviewCache,
    original: Original,
    pipeline: Pipeline,
    baseKey: string,
    stageKeys: string[],
    previewLongEdge: number,
    targetStageIndex: number
  ): Promise<PreviewBitmap> {
    let startIndex = -1;
    let current: PreviewBitmap | null = null;
    for (let index = Math.min(targetStageIndex, stageKeys.length - 1); index >= 0; index -= 1) {
      const cached = cache.stages.get(stageKeys[index]);
      if (cached) {
        startIndex = index;
        current = cached;
        break;
      }
    }
    current ??= await this.previewBase(cache, original, pipeline, baseKey, previewLongEdge);

    for (let opIndex = startIndex + 1; opIndex <= targetStageIndex; opIndex += 1) {
      const op = pipeline.ops[opIndex];
      if (!op) break;
      current = await this.renderOpStage(current, op, pipeline);
      cache.stages.set(stageKeys[opIndex], current);
    }

    return current;
  }

  private taskCache(taskId: string): TaskPreviewCache {
    const cache = this.#tasks.get(taskId) ?? { base: null, stages: new Map() };
    // Re-insert so the map stays ordered from least to most recently previewed.
    this.#tasks.delete(taskId);
    this.#tasks.set(taskId, cache);
    return cache;
  }

  /** Drops the least recently previewed tasks' chains until the others fit the budget. */
  private enforceBudget(activeTaskId: string): void {
    let total = 0;
    const sizes = new Map<string, number>();
    for (const [taskId, cache] of this.#tasks) {
      if (taskId === activeTaskId) continue;
      const size = cacheBytes(cache);
      sizes.set(taskId, size);
      total += size;
    }
    for (const [taskId, size] of sizes) {
      if (total <= this.#budgetBytes) break;
      this.#tasks.delete(taskId);
      total -= size;
    }
  }

  private async previewBase(cache: TaskPreviewCache, original: Original, pipeline: Pipeline, key: string, previewLongEdge: number): Promise<BasePreviewEntry> {
    if (cache.base?.key === key) {
      return cache.base;
    }

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

function previewBaseKey(original: Original, previewLongEdge: number): string {
  return `${original.id}:${original.sourceHash}:${previewLongEdge}`;
}

/** Content keys for every stage of the chain: stage i is named by the base and ops 0..i. */
function previewStageKeys(baseKey: string, ops: OpInstance[]): string[] {
  const keys: string[] = [];
  let previous = baseKey;
  for (const op of ops) {
    previous = createHash("sha256")
      .update(previous)
      .update("\0")
      .update(JSON.stringify({ type: op.type, enabled: op.enabled, params: op.params }))
      .digest("hex");
    keys.push(previous);
  }
  return keys;
}

function cacheBytes(cache: TaskPreviewCache): number {
  // A pass-through stage shares its input's bitmap; count each buffer once.
  const buffers = new Set<Buffer>();
  if (cache.base) buffers.add(cache.base.data);
  for (const stage of cache.stages.values()) buffers.add(stage.data);
  let total = 0;
  for (const buffer of buffers) total += buffer.byteLength;
  return total;
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
