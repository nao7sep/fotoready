import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import { createEmptyProject, defaultPipeline } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import type { Original, Project, Task } from "@shared/types/project";
import { sha256Bytes } from "@runtime/hash";
import { inspectSourceImage } from "@runtime/decode";
import type { PreviewRenderOptions, QueueSnapshot, RenamePreview, TaskDeleteOptions } from "@shared/types/ipc";
import { getOpDefinition, getOpModule } from "@core/ops/catalog";
import { renderOriginalThumbnail, renderTaskPreview, type OriginalThumbnail, type PreviewResult } from "@main/preview-service";
import { previewRename, runRename } from "@main/rename-service";
import type { VisionQueue } from "@main/queues/vision";
import type { ProcessingQueue } from "@main/queues/processing-queue";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { deleteSelectedFiles } from "@main/safe-delete";
import { applyOpParamChange, applyOpParamPatch } from "@shared/validation/ops";
import { applyOutputSettingChange } from "@shared/validation/pipeline";

export type ProjectSessionSnapshot = {
  project: Project;
  activeTaskId: string | null;
};

export class ProjectSession {
  #project: Project;
  #activeTaskId: string | null = null;
  #taskUndoHistory = new Map<string, Task[]>();
  #snapshotListener: ((snapshot: ProjectSessionSnapshot, queue: QueueSnapshot) => void | Promise<void>) | null = null;

  constructor(
    private readonly settings: GlobalSettings,
    private readonly visionQueue: VisionQueue,
    private readonly processingQueue: ProcessingQueue,
    private readonly workerPool: PipelineWorkerPool
  ) {
    this.#project = createEmptyProject(settings.defaultOutputDirectory.trim() || null);
  }

  snapshot(): ProjectSessionSnapshot {
    return {
      project: this.#project,
      activeTaskId: this.#activeTaskId
    };
  }

  setSnapshotListener(listener: (snapshot: ProjectSessionSnapshot, queue: QueueSnapshot) => void | Promise<void>): void {
    this.#snapshotListener = listener;
  }

  async emitSnapshot(): Promise<void> {
    await this.#snapshotListener?.(this.snapshot(), this.queueSnapshot());
  }

  setOutputDir(outputDir: string | null): ProjectSessionSnapshot {
    this.#project.outputDir = outputDir && outputDir.trim().length > 0 ? outputDir : null;
    return this.snapshot();
  }

  async addOriginals(sourcePaths: string[]): Promise<ProjectSessionSnapshot> {
    for (const sourcePath of sourcePaths) {
      const original = await buildOriginal(sourcePath);
      const existing = this.#project.originals.find((item) => item.sourceHash === original.sourceHash);
      const targetOriginal = existing ?? original;

      if (!existing) {
        this.#project.originals.push(original);
      }

      this.selectOriginal(targetOriginal.id);
    }

    return this.snapshot();
  }

  selectOriginal(originalId: string): ProjectSessionSnapshot {
    const original = this.#project.originals.find((item) => item.id === originalId);
    if (!original) {
      throw new Error(`Original not found: ${originalId}`);
    }

    const activeTask = this.#activeTaskId ? this.#project.tasks.find((task) => task.id === this.#activeTaskId) : null;
    if (activeTask && activeTask.status === "pending" && !activeTask.everEdited) {
      activeTask.originalId = original.id;
      activeTask.updatedAt = nowIso();
      return this.snapshot();
    }

    const task = createTaskForOriginal(original.id, this.settings);
    this.#project.tasks.push(task);
    this.#activeTaskId = task.id;
    return this.snapshot();
  }

  removeOriginal(originalId: string): ProjectSessionSnapshot {
    const originalIndex = this.#project.originals.findIndex((item) => item.id === originalId);
    if (originalIndex === -1) {
      throw new Error(`Original not found: ${originalId}`);
    }

    const removedTaskIds = new Set(this.#project.tasks.filter((task) => task.originalId === originalId).map((task) => task.id));
    this.#project.originals.splice(originalIndex, 1);
    this.#project.tasks = this.#project.tasks.filter((task) => !removedTaskIds.has(task.id));
    for (const taskId of removedTaskIds) {
      this.#taskUndoHistory.delete(taskId);
    }

    if (this.#activeTaskId && removedTaskIds.has(this.#activeTaskId)) {
      this.#activeTaskId = this.#project.tasks[0]?.id ?? null;
    }

    return this.snapshot();
  }

  selectTask(taskId: string): ProjectSessionSnapshot {
    if (!this.#project.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task not found: ${taskId}`);
    }
    this.#activeTaskId = taskId;
    return this.snapshot();
  }

  forkTask(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const fork = createTaskForOriginal(task.originalId, this.settings);
    fork.pipeline = structuredClone(task.pipeline);
    fork.everEdited = true;
    this.#project.tasks.push(fork);
    this.#activeTaskId = fork.id;
    return this.snapshot();
  }

  async deleteTask(taskId: string, options: TaskDeleteOptions = {}): Promise<ProjectSessionSnapshot> {
    const index = this.#project.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = this.#project.tasks[index];
    const outputPaths = task.output
      ? [
          options.deleteStagedOutput ? task.output.stagedPath : null,
          options.deleteFinalOutput ? task.output.finalPath : null
        ].filter((filePath): filePath is string => typeof filePath === "string")
      : [];
    await deleteSelectedFiles(outputPaths);

    this.#project.tasks.splice(index, 1);
    this.#taskUndoHistory.delete(taskId);
    if (this.#activeTaskId === taskId) {
      this.#activeTaskId = this.#project.tasks[index]?.id ?? this.#project.tasks[index - 1]?.id ?? null;
    }
    return this.snapshot();
  }

  dismissTaskError(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.error = null;
    if (task.status === "error") {
      task.status = "pending";
    }
    task.updatedAt = nowIso();
    return this.snapshot();
  }

  retryTask(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.error?.stage === "vision" && task.status === "done") {
      task.error = null;
      void this.runVision(taskId);
      return this.snapshot();
    }

    task.status = "pending";
    task.error = null;
    task.output = null;
    task.updatedAt = nowIso();
    this.enqueueSave(taskId);
    return this.snapshot();
  }

  enqueueSave(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "pending") {
      return this.snapshot();
    }
    task.status = "queued";
    task.error = null;
    task.updatedAt = nowIso();

    void this.processingQueue.enqueueTask(this.#project, taskId).catch(() => {
      /* errors are surfaced via task.error in processTask */
    });

    return this.snapshot();
  }

  enqueueSaveAll(): ProjectSessionSnapshot {
    const pendingIds = this.#project.tasks.filter((task) => task.status === "pending").map((task) => task.id);
    for (const taskId of pendingIds) {
      this.enqueueSave(taskId);
    }
    return this.snapshot();
  }

  cancelTask(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "queued") {
      this.processingQueue.cancelTask(taskId);
      task.status = "pending";
      task.updatedAt = nowIso();
    }
    return this.snapshot();
  }

  cancelAll(): ProjectSessionSnapshot {
    const cancelledIds = this.processingQueue.cancelAll();
    const cancelledSet = new Set(cancelledIds);
    for (const task of this.#project.tasks) {
      if (task.status === "queued" || cancelledSet.has(task.id)) {
        task.status = "pending";
        task.updatedAt = nowIso();
      }
    }
    return this.snapshot();
  }

  queueSnapshot(): QueueSnapshot {
    return this.processingQueue.snapshot(this.#project);
  }

  async renderPreview(taskId: string, options?: PreviewRenderOptions): Promise<PreviewResult> {
    return renderTaskPreview(this.#project, taskId, this.settings.previewLongEdge, this.workerPool, options);
  }

  async renderOriginalThumbnail(originalId: string): Promise<OriginalThumbnail> {
    const original = this.#project.originals.find((item) => item.id === originalId);
    if (!original) {
      throw new Error(`Original not found: ${originalId}`);
    }
    return renderOriginalThumbnail(original);
  }

  addOp(taskId: string, opType: string): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const definition = getOpDefinition(opType);
    if (!definition) {
      throw new Error(`Unknown op: ${opType}`);
    }
    this.recordTaskEdit(task);

    const params = structuredClone(definition.defaultParams);
    if (opType === "watermark-image" && typeof params.pngPath === "string" && !params.pngPath && this.settings.defaultWatermarkImage) {
      params.pngPath = this.settings.defaultWatermarkImage;
    }
    task.pipeline.ops.push({
      id: nanoid(),
      type: definition.type,
      params,
      enabled: true
    });
    touchTask(task);
    return this.snapshot();
  }

  removeOp(taskId: string, opId: string): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    this.recordTaskEdit(task);
    task.pipeline.ops.splice(opIndex, 1);
    touchTask(task);
    return this.snapshot();
  }

  moveOp(taskId: string, opId: string, toIndex: number): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const fromIndex = findOpIndex(task, opId);
    assertOpTargetIndex(task, toIndex);
    if (fromIndex === toIndex) {
      return this.snapshot();
    }
    this.recordTaskEdit(task);
    const [op] = task.pipeline.ops.splice(fromIndex, 1);
    if (!op) {
      throw new Error(`Op not found: ${opId}`);
    }
    task.pipeline.ops.splice(toIndex, 0, op);
    touchTask(task);
    return this.snapshot();
  }

  setOpEnabled(taskId: string, opId: string, enabled: boolean): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    this.recordTaskEdit(task);
    task.pipeline.ops[opIndex].enabled = enabled;
    touchTask(task);
    return this.snapshot();
  }

  updateOpParam(taskId: string, opId: string, key: string, value: unknown): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    const nextOp = applyOpParamChange(task.pipeline.ops[opIndex], key, value, getOpModule);
    this.recordTaskEdit(task);
    task.pipeline.ops[opIndex] = nextOp;
    touchTask(task);
    return this.snapshot();
  }

  updateOpParams(taskId: string, opId: string, patch: Record<string, unknown>): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    const nextOp = applyOpParamPatch(task.pipeline.ops[opIndex], patch, getOpModule);
    this.recordTaskEdit(task);
    task.pipeline.ops[opIndex] = nextOp;
    touchTask(task);
    return this.snapshot();
  }

  setAnalyzeContent(taskId: string, analyzeContent: boolean): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.analyzeContent = analyzeContent;
    touchTask(task);
    return this.snapshot();
  }

  setCustomSlug(taskId: string, customSlug: string | null): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.customSlug = customSlug && customSlug.trim().length > 0 ? customSlug : null;
    touchTask(task);
    return this.snapshot();
  }

  updateOutput(taskId: string, key: string, value: unknown): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.pipeline.output = nextTaskOutput(task.pipeline.output, key, value, this.settings);
    touchTask(task);
    return this.snapshot();
  }

  undoTaskEdit(taskId: string): ProjectSessionSnapshot {
    const index = this.#project.tasks.findIndex((item) => item.id === taskId);
    const task = index >= 0 ? this.#project.tasks[index] : null;
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "pending") {
      throw new Error("Only pending tasks can be undone. Fork this task before editing.");
    }

    const history = this.#taskUndoHistory.get(taskId);
    const previous = history?.pop();
    if (!previous) {
      return this.snapshot();
    }

    this.#project.tasks[index] = previous;
    return this.snapshot();
  }

  async previewRename(templateId?: string, taskIds?: string[]): Promise<RenamePreview> {
    return previewRename(this.#project, this.settings, templateId, taskIds);
  }

  async runRename(templateId?: string, taskIds?: string[]): Promise<ProjectSessionSnapshot> {
    await runRename(this.#project, this.settings, templateId, taskIds);
    return this.snapshot();
  }

  async runVision(taskId: string): Promise<ProjectSessionSnapshot> {
    await this.visionQueue.runForTask(this.#project, taskId);
    return this.snapshot();
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    await this.visionQueue.setGeminiApiKey(apiKey);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.visionQueue.hasGeminiApiKey();
  }

  private editableTask(taskId: string): Task {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "pending") {
      throw new Error("Only pending tasks can be edited. Fork this task before editing.");
    }
    return task;
  }

  private recordTaskEdit(task: Task): void {
    const history = this.#taskUndoHistory.get(task.id) ?? [];
    history.push(structuredClone(task));
    if (history.length > 50) history.shift();
    this.#taskUndoHistory.set(task.id, history);
  }
}

async function buildOriginal(sourcePath: string): Promise<Original> {
  const bytes = await fs.readFile(sourcePath);
  const { format, metadata } = await inspectSourceImage(bytes);

  return {
    id: nanoid(),
    sourcePath: path.resolve(sourcePath),
    sourceHash: sha256Bytes(bytes),
    size: bytes.byteLength,
    format,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    addedAt: nowIso()
  };
}

function createTaskForOriginal(originalId: string, settings: GlobalSettings): Task {
  const now = nowIso();
  const pipeline = defaultPipeline();
  pipeline.output = defaultTaskOutput(settings, pipeline.output);

  return {
    id: nanoid(),
    originalId,
    analyzeContent: settings.defaultAnalyzeContent,
    customSlug: null,
    pipeline,
    status: "pending",
    output: null,
    error: null,
    everEdited: false,
    createdAt: now,
    updatedAt: now
  };
}

function defaultTaskOutput(settings: GlobalSettings, fallback: Task["pipeline"]["output"]): Task["pipeline"]["output"] {
  const format = settings.defaultOutputFormat;
  return {
    ...fallback,
    format,
    quality: defaultQualityForFormat(format, settings, fallback.quality),
    jpegProgressive: settings.jpegProgressive,
    jpegChromaSubsampling: settings.jpegChromaSubsampling,
    webpMethod: settings.webpMethod,
    avifEffort: settings.avifEffort,
    pngPalette: settings.defaultPngPalette,
    backgroundForTransparency: settings.defaultBackgroundForTransparency
  };
}

function nextTaskOutput(
  current: Task["pipeline"]["output"],
  key: string,
  value: unknown,
  settings: GlobalSettings
): Task["pipeline"]["output"] {
  const nextOutput = applyOutputSettingChange(current, key, value);
  if (key !== "format") {
    return nextOutput;
  }

  return {
    ...nextOutput,
    quality: defaultQualityForFormat(nextOutput.format, settings, current.quality)
  };
}

function defaultQualityForFormat(
  format: Task["pipeline"]["output"]["format"],
  settings: GlobalSettings,
  fallback: Task["pipeline"]["output"]["quality"]
): Task["pipeline"]["output"]["quality"] {
  if (format === "webp") return settings.defaultWebpQuality;
  if (format === "avif") return settings.defaultAvifQuality;
  if (format === "png") return typeof fallback === "number" ? fallback : 82;
  if (settings.jpegStrategy === "match-source-size") return "match-source-size";
  if (settings.jpegStrategy === "match-source-quality") return "match-source-quality";
  return settings.jpegFixedQuality;
}

function findOpIndex(task: Task, opId: string): number {
  if (typeof opId !== "string" || opId.trim().length === 0) {
    throw new Error("Op id must be a non-empty string.");
  }
  const opIndex = task.pipeline.ops.findIndex((op) => op.id === opId);
  if (opIndex === -1) {
    throw new Error(`Op not found: ${opId}`);
  }
  return opIndex;
}

function assertOpTargetIndex(task: Task, opIndex: number): void {
  if (!Number.isInteger(opIndex) || opIndex < 0 || opIndex >= task.pipeline.ops.length) {
    throw new Error(`Op target index out of range: ${opIndex}`);
  }
}

function touchTask(task: Task): void {
  task.everEdited = true;
  task.updatedAt = nowIso();
  task.output = null;
  task.error = null;
}
