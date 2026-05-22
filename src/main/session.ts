import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { nowIso } from "@shared/time";
import { createEmptyProject, defaultPipeline } from "@shared/defaults";
import { clamp } from "@shared/numeric";
import { EDITABLE_METADATA_FIELDS, type GlobalSettings, type MetadataFields } from "@shared/types/settings";
import type { Original, Project, Task } from "@shared/types/project";
import { sha256Bytes } from "@runtime/hash";
import { inspectSourceImage } from "@runtime/decode";
import { detectJpegQuality } from "@runtime/jpeg-quality";
import type { PreviewRenderOptions, QueueSnapshot, RenamePreview, TaskDeleteOptions, TaskEditOptions, VisionRunOptions } from "@shared/types/ipc";
import { getOpDefinition, getOpModule } from "@core/ops/catalog";
import { PreviewService } from "@main/preview-service";
import type { OriginalThumbnail, PreviewResult } from "@shared/types/ipc";
import { previewRename, runRename } from "@main/rename-service";
import type { VisionQueue } from "@main/queues/vision";
import type { ProcessingQueue } from "@main/queues/processing-queue";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { deleteSelectedFiles } from "@main/safe-delete";
import { isTaskSidecarPath, loadTaskSidecars, matchingTaskSidecar, writeTaskSidecarFile } from "@main/task-sidecar";
import { applyOpParamChange, applyOpParamPatch } from "@shared/validation/ops";
import { applyOutputSettingChange } from "@shared/validation/pipeline";
import { resolveOutputFormat } from "@shared/output-format";
import { DEFAULT_ASSET_OVERLAY_WIDTH, clampAssetOverlay, type AssetOverlayParams } from "@shared/asset-overlay";
import type { BoxBounds } from "@shared/box-geometry";
import { resolveVisionRunMode } from "@shared/vision-run-mode";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";
import { readSourceMetadataSummary } from "@adapters/exiftool";
import { placeNewBoxOverlay } from "@main/overlay-default-placement";
import type { RenameTemplateId } from "@shared/rename-template";
import { normalizeSlugCandidate } from "@core/slug/rules";
import { computePrivacyWarning } from "@main/privacy-warning";
import type { PrivacyWarning } from "@shared/types/ipc";

export type ProjectSessionSnapshot = {
  project: Project;
  activeTaskId: string | null;
  privacyWarnings: Record<string, PrivacyWarning>;
};

export class ProjectSession {
  #project: Project;
  #activeTaskId: string | null = null;
  #taskUndoHistory = new Map<string, Task[]>();
  #lastTaskUndoHistoryGroup = new Map<string, string | null>();
  #previewService: PreviewService;
  #snapshotListener: ((snapshot: ProjectSessionSnapshot, queue: QueueSnapshot) => void | Promise<void>) | null = null;

  constructor(
    private readonly settings: GlobalSettings,
    private readonly visionQueue: VisionQueue,
    private readonly processingQueue: ProcessingQueue,
    private readonly workerPool: PipelineWorkerPool
  ) {
    this.#project = createEmptyProject(settings.defaultOutputDirectory.trim() || null);
    this.#previewService = new PreviewService(workerPool);
  }

  snapshot(): ProjectSessionSnapshot {
    return {
      project: this.#project,
      activeTaskId: this.#activeTaskId,
      privacyWarnings: this.#computePrivacyWarnings()
    };
  }

  #computePrivacyWarnings(): Record<string, PrivacyWarning> {
    const out: Record<string, PrivacyWarning> = {};
    for (const task of this.#project.tasks) {
      const original = this.#project.originals.find((item) => item.id === task.originalId);
      if (!original) continue;
      const warning = computePrivacyWarning(task, original, this.settings);
      if (warning) out[task.id] = warning;
    }
    return out;
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
    const sidecars = await loadTaskSidecars(sourcePaths);
    for (const sourcePath of sourcePaths) {
      if (isTaskSidecarPath(sourcePath)) continue;
      const original = await buildOriginal(sourcePath, this.settings.enableJpegQualityEstimate);
      const existing = this.#project.originals.find((item) => item.sourceHash === original.sourceHash);
      const targetOriginal = existing ?? original;

      if (!existing) {
        this.#project.originals.push(original);
      }

      const matchedSidecar = matchingTaskSidecar(targetOriginal, sidecars);
      if (matchedSidecar) {
        const task = createTaskFromSidecar(targetOriginal, this.settings, matchedSidecar.sidecar);
        this.#project.tasks.push(task);
        this.#activeTaskId = task.id;
        continue;
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
    if (activeTask && activeTask.status === "not-saved" && !activeTask.everEdited) {
      activeTask.originalId = original.id;
      activeTask.updatedAt = nowIso();
      this.#previewService.invalidateTask(activeTask.id);
      return this.snapshot();
    }

    const task = createTaskForOriginal(original, this.settings);
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
      this.#previewService.invalidateTask(taskId);
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
    const original = this.#project.originals.find((item) => item.id === task.originalId);
    if (!original) {
      throw new Error(`Original not found for task: ${taskId}`);
    }

    const fork = createTaskForOriginal(original, this.settings);
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
          options.deleteStagedOutput ? task.output.stagedParamsPath : null,
          options.deleteFinalOutput ? task.output.finalPath : null
          ,
          options.deleteFinalOutput ? task.output.finalParamsPath : null
        ].filter((filePath): filePath is string => typeof filePath === "string")
      : [];
    await deleteSelectedFiles(outputPaths);

    this.#project.tasks.splice(index, 1);
    this.#taskUndoHistory.delete(taskId);
    this.#previewService.invalidateTask(taskId);
    if (this.#activeTaskId === taskId) {
      this.#activeTaskId = this.#project.tasks[index]?.id ?? this.#project.tasks[index - 1]?.id ?? null;
    }
    return this.snapshot();
  }

  async deleteSavedOutput(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!task.output) {
      return this.snapshot();
    }

    await deleteSelectedFiles([
      task.output.finalPath,
      task.output.finalParamsPath,
      task.output.stagedPath,
      task.output.stagedParamsPath
    ].filter((filePath): filePath is string => typeof filePath === "string"));

    task.status = "not-saved";
    task.output = null;
    task.error = null;
    task.updatedAt = nowIso();
    return this.snapshot();
  }

  dismissTaskError(taskId: string): ProjectSessionSnapshot {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.error = null;
    if (task.status === "error") {
      task.status = "not-saved";
    }
    task.updatedAt = nowIso();
    return this.snapshot();
  }

  async retryTask(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.error?.stage === "vision" && task.status === "saved") {
      task.error = null;
      return this.runVision(taskId);
    }

    task.status = "not-saved";
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
    if (task.status !== "not-saved") {
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
    const notSavedIds = this.#project.tasks.filter((task) => task.status === "not-saved").map((task) => task.id);
    for (const taskId of notSavedIds) {
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
      task.status = "not-saved";
      task.updatedAt = nowIso();
    }
    this.visionQueue.cancelTask(taskId);
    return this.snapshot();
  }

  cancelAll(): ProjectSessionSnapshot {
    const cancelledIds = this.processingQueue.cancelAll();
    const cancelledSet = new Set(cancelledIds);
    for (const task of this.#project.tasks) {
      if (task.status === "queued" || cancelledSet.has(task.id)) {
        task.status = "not-saved";
        task.updatedAt = nowIso();
      }
    }
    this.visionQueue.cancelAll();
    return this.snapshot();
  }

  queueSnapshot(): QueueSnapshot {
    return this.processingQueue.snapshot(this.#project);
  }

  async renderPreview(taskId: string, options?: PreviewRenderOptions): Promise<PreviewResult> {
    return this.#previewService.renderTaskPreview(this.#project, taskId, this.settings.previewLongEdge, options);
  }

  async renderOriginalThumbnail(originalId: string): Promise<OriginalThumbnail> {
    const original = this.#project.originals.find((item) => item.id === originalId);
    if (!original) {
      throw new Error(`Original not found: ${originalId}`);
    }
    return this.#previewService.renderOriginalThumbnail(original);
  }

  async afterTaskProcessed(taskId: string): Promise<void> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "saved" || !task.output || (!task.generateDescription && !task.generateSlug)) {
      return;
    }
    if (!(await this.visionQueue.hasGeminiApiKey())) {
      return;
    }
    void this.runVision(taskId, { mode: task.generateSlug ? "description-and-slug" : "description" });
  }

  async addOp(taskId: string, opType: string): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    const definition = getOpDefinition(opType);
    if (!definition) {
      throw new Error(`Unknown op: ${opType}`);
    }
    this.recordTaskEdit(task);

    const params = structuredClone(definition.defaultParams);
    if (opType === "watermark-image" && typeof params.assetPath === "string" && !params.assetPath && this.settings.defaultWatermarkImage) {
      params.assetPath = this.settings.defaultWatermarkImage;
    }
    if (opType === "watermark-text" && typeof params.fontFamily === "string" && this.settings.defaultWatermarkTextFontFamily.trim()) {
      params.fontFamily = this.settings.defaultWatermarkTextFontFamily.trim();
    }
    if (opType === "inject-metadata" && params.fields && typeof params.fields === "object") {
      params.fields = metadataFieldsWithValues(this.settings.injectFields);
    }
    const original = this.#project.originals.find((item) => item.id === task.originalId) ?? null;
    if (original) {
      await initializeOpParamsForOriginal(opType, params, original);
    }
    placeNewBoxOverlay(opType, params, original ? imageBoundsForOriginal(original) : { maxX: 1, maxY: 1 });
    task.pipeline.ops.push({
      id: nanoid(),
      type: definition.type,
      params,
      enabled: true
    });
    this.#previewService.invalidateTaskFrom(task.id, task.pipeline.ops.length - 1);
    touchTask(task);
    return this.snapshot();
  }

  removeOp(taskId: string, opId: string): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    this.recordTaskEdit(task);
    this.#previewService.invalidateTaskFrom(task.id, opIndex);
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
    this.#previewService.invalidateTaskFrom(task.id, Math.min(fromIndex, toIndex));
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
    this.#previewService.invalidateTaskFrom(task.id, opIndex);
    task.pipeline.ops[opIndex].enabled = enabled;
    touchTask(task);
    return this.snapshot();
  }

  updateOpParam(taskId: string, opId: string, key: string, value: unknown, options?: TaskEditOptions): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    const nextOp = applyOpParamChange(task.pipeline.ops[opIndex], key, value, getOpModule);
    if (JSON.stringify(task.pipeline.ops[opIndex].params) === JSON.stringify(nextOp.params)) {
      return this.snapshot();
    }
    this.recordTaskEdit(task, options);
    this.#previewService.invalidateTaskFrom(task.id, opIndex);
    task.pipeline.ops[opIndex] = nextOp;
    touchTask(task);
    return this.snapshot();
  }

  updateOpParams(taskId: string, opId: string, patch: Record<string, unknown>, options?: TaskEditOptions): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const opIndex = findOpIndex(task, opId);
    const nextOp = applyOpParamPatch(task.pipeline.ops[opIndex], patch, getOpModule);
    if (JSON.stringify(task.pipeline.ops[opIndex].params) === JSON.stringify(nextOp.params)) {
      return this.snapshot();
    }
    this.recordTaskEdit(task, options);
    this.#previewService.invalidateTaskFrom(task.id, opIndex);
    task.pipeline.ops[opIndex] = nextOp;
    touchTask(task);
    return this.snapshot();
  }

  async setGenerateDescription(taskId: string, generateDescription: boolean): Promise<ProjectSessionSnapshot> {
    const task = this.metadataTask(taskId);
    if (task.status === "not-saved") this.recordTaskEdit(task);
    task.generateDescription = generateDescription || task.generateSlug;
    touchTaskMetadata(task);
    await this.writeOutputSidecarIfSaved(task);
    return this.snapshot();
  }

  async setGenerateSlug(taskId: string, generateSlug: boolean): Promise<ProjectSessionSnapshot> {
    const task = this.metadataTask(taskId);
    if (task.status === "not-saved") this.recordTaskEdit(task);
    task.generateSlug = generateSlug;
    task.generateDescription = generateSlug ? true : task.generateDescription;
    touchTaskMetadata(task);
    await this.writeOutputSidecarIfSaved(task);
    return this.snapshot();
  }

  async setCustomSlug(taskId: string, customSlug: string | null): Promise<ProjectSessionSnapshot> {
    const task = this.metadataTask(taskId);
    if (task.status === "not-saved") this.recordTaskEdit(task);
    task.customSlug = normalizeOptionalSlug(customSlug);
    touchTaskMetadata(task);
    await this.writeOutputSidecarIfSaved(task);
    return this.snapshot();
  }

  updateOutput(taskId: string, key: string, value: unknown, options?: TaskEditOptions): ProjectSessionSnapshot {
    const task = this.editableTask(taskId);
    const original = this.#project.originals.find((item) => item.id === task.originalId);
    if (!original) {
      throw new Error(`Original not found for task: ${task.id}`);
    }
    const nextOutput = nextTaskOutput(task.pipeline.output, key, value, this.settings, original.format);
    if (JSON.stringify(task.pipeline.output) === JSON.stringify(nextOutput)) {
      return this.snapshot();
    }
    this.recordTaskEdit(task, options);
    task.pipeline.output = nextOutput;
    touchTask(task);
    return this.snapshot();
  }

  undoTaskEdit(taskId: string): ProjectSessionSnapshot {
    const index = this.#project.tasks.findIndex((item) => item.id === taskId);
    const task = index >= 0 ? this.#project.tasks[index] : null;
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "not-saved") {
      throw new Error("Only not-saved tasks can be undone. Fork this task before editing.");
    }

    const history = this.#taskUndoHistory.get(taskId);
    const previous = history?.pop();
    if (!previous) {
      return this.snapshot();
    }

    this.#project.tasks[index] = previous;
    this.#lastTaskUndoHistoryGroup.delete(taskId);
    this.#previewService.invalidateTask(taskId);
    return this.snapshot();
  }

  async previewRename(templateId?: RenameTemplateId, taskIds?: string[]): Promise<RenamePreview> {
    return previewRename(this.#project, templateId, taskIds);
  }

  async runRename(templateId?: RenameTemplateId, taskIds?: string[]): Promise<ProjectSessionSnapshot> {
    await runRename(this.#project, templateId, taskIds);
    return this.snapshot();
  }

  async runVision(taskId: string, options?: VisionRunOptions): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const mode = resolveVisionRunMode(task, options);
    if (!mode) return this.snapshot();
    task.visionRunning = true;
    task.visionRunMode = mode;
    if (task.error?.stage === "vision") task.error = null;
    task.updatedAt = nowIso();
    await this.emitSnapshot();
    try {
      await this.visionQueue.runForTask(this.#project, taskId, options, async () => {
        await this.writeOutputSidecarIfSaved(task);
        await this.emitSnapshot();
      });
      await this.writeOutputSidecarIfSaved(task);
    } finally {
      task.visionRunning = false;
      task.visionRunMode = null;
      task.updatedAt = nowIso();
      await this.emitSnapshot();
    }
    return this.snapshot();
  }

  async clearVision(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.metadataTask(taskId);
    const vision = task.output?.vision ?? null;
    if (!vision) return this.snapshot();
    if (task.customSlug && vision.slugCandidates.includes(task.customSlug)) {
      task.customSlug = null;
    }
    if (task.output) task.output.vision = null;
    if (task.error?.stage === "vision") task.error = null;
    touchTaskMetadata(task);
    await this.writeOutputSidecarIfSaved(task);
    return this.snapshot();
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    await this.visionQueue.setGeminiApiKey(apiKey);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.visionQueue.hasGeminiApiKey();
  }

  async clearGeminiApiKey(): Promise<void> {
    await this.visionQueue.clearGeminiApiKey();
  }

  private editableTask(taskId: string): Task {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "not-saved") {
      throw new Error("Only not-saved tasks can be edited. Fork this task before editing.");
    }
    return task;
  }

  private metadataTask(taskId: string): Task {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "queued" || task.status === "processing") {
      throw new Error("Task metadata cannot be edited while the task is queued or processing.");
    }
    return task;
  }

  private async writeOutputSidecarIfSaved(task: Task): Promise<void> {
    const original = this.#project.originals.find((item) => item.id === task.originalId);
    if (!task.output || !original) return;
    const outputPath = task.output.finalPath ?? task.output.stagedPath;
    const paramsPath = await writeTaskSidecarFile(outputPath, original, task, task.pipeline);
    task.output.stagedPath = outputPath;
    task.output.stagedParamsPath = paramsPath;
    if (task.output.finalPath) {
      task.output.finalPath = outputPath;
      task.output.finalParamsPath = paramsPath;
    }
  }

  private recordTaskEdit(task: Task, options?: TaskEditOptions): void {
    const historyGroup = typeof options?.historyGroup === "string" && options.historyGroup.length > 0 ? options.historyGroup : null;
    if (historyGroup && this.#lastTaskUndoHistoryGroup.get(task.id) === historyGroup) {
      return;
    }

    const history = this.#taskUndoHistory.get(task.id) ?? [];
    history.push(structuredClone(task));
    if (history.length > 50) history.shift();
    this.#taskUndoHistory.set(task.id, history);
    this.#lastTaskUndoHistoryGroup.set(task.id, historyGroup);
  }
}

async function buildOriginal(sourcePath: string, enableJpegQualityEstimate: boolean): Promise<Original> {
  const bytes = await fs.readFile(sourcePath);
  const { format, metadata } = await inspectSourceImage(bytes);
  const jpegQualityEstimate = enableJpegQualityEstimate && format === "jpeg" ? detectJpegQuality(bytes).jpegQualityEstimate?.value ?? null : null;
  const metadataSummary = await readSourceMetadataSummary(sourcePath);

  return {
    id: nanoid(),
    sourcePath: path.resolve(sourcePath),
    sourceHash: sha256Bytes(bytes),
    size: bytes.byteLength,
    format,
    jpegQualityEstimate,
    metadataSummary,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    addedAt: nowIso()
  };
}

function createTaskForOriginal(original: Original, settings: GlobalSettings): Task {
  const now = nowIso();
  const pipeline = defaultPipeline();
  pipeline.output = defaultTaskOutput(settings, original.format, pipeline.output);

  return {
    id: nanoid(),
    originalId: original.id,
    generateDescription: settings.defaultGenerateDescription || settings.defaultGenerateSlug,
    generateSlug: settings.defaultGenerateSlug,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline,
    status: "not-saved",
    output: null,
    error: null,
    everEdited: false,
    createdAt: now,
    updatedAt: now
  };
}

function createTaskFromSidecar(original: Original, settings: GlobalSettings, sidecar: Awaited<ReturnType<typeof loadTaskSidecars>>[number]["sidecar"]): Task {
  const task = createTaskForOriginal(original, settings);
  task.pipeline = structuredClone(sidecar.task.pipeline);
  task.generateDescription = sidecar.task.generateDescription || sidecar.task.generateSlug;
  task.generateSlug = sidecar.task.generateSlug;
  task.customSlug = normalizeOptionalSlug(sidecar.task.customSlug) ?? normalizeOptionalSlug(sidecar.task.vision?.slugCandidates[0] ?? null);
  task.everEdited = true;
  return task;
}

function normalizeOptionalSlug(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeSlugCandidate(value);
  return normalized || null;
}

function defaultTaskOutput(settings: GlobalSettings, originalFormat: string, fallback: Task["pipeline"]["output"]): Task["pipeline"]["output"] {
  const format = settings.defaultOutputFormat;
  return {
    ...fallback,
    format,
    quality: defaultQualityForFormat(format, settings, originalFormat, fallback.quality),
    flattenTransparency: settings.defaultFlattenTransparency,
    jpegProgressive: settings.jpegProgressive,
    jpegChromaSubsampling: settings.jpegChromaSubsampling,
    webpMethod: settings.webpMethod,
    avifEffort: settings.avifEffort,
    pngPalette: settings.defaultPngPalette,
    backgroundForTransparency: settings.defaultBackgroundForTransparency
  };
}

async function initializeOpParamsForOriginal(opType: string, params: Record<string, unknown>, original: Original): Promise<void> {
  const imageBounds = imageBoundsForOriginal(original);
  if (opType === "watermark-text") {
    if (
      typeof params.x !== "number"
      || typeof params.y !== "number"
      || typeof params.w !== "number"
      || typeof params.h !== "number"
    ) {
      return;
    }
    const w = clamp(params.w, 0.02, Math.max(0.02, imageBounds.maxX));
    const h = clamp(params.h, 0.02, Math.max(0.02, imageBounds.maxY));
    params.w = w;
    params.h = h;
    params.x = clamp(params.x, 0, Math.max(0, imageBounds.maxX - w));
    params.y = clamp(params.y, 0, Math.max(0, imageBounds.maxY - h));
    return;
  }
  if (opType !== "watermark-image" && opType !== "stamp") return;
  if (
    typeof params.assetPath !== "string"
    || typeof params.x !== "number"
    || typeof params.y !== "number"
    || typeof params.width !== "number"
    || typeof params.height !== "number"
    || typeof params.lockAspectRatio !== "boolean"
    || typeof params.opacity !== "number"
    || typeof params.rotation !== "number"
  ) {
    return;
  }
  const ar = params.assetPath ? await readAssetAspectRatio(params.assetPath as string) : 1;
  const width = DEFAULT_ASSET_OVERLAY_WIDTH;
  const height = width / Math.max(0.01, ar);
  Object.assign(params, clampAssetOverlay({ ...(params as unknown as AssetOverlayParams), width, height }, imageBounds));
}

function imageBoundsForOriginal(original: Original): BoxBounds {
  const longEdge = Math.max(original.width, original.height, 1);
  return { maxX: original.width / longEdge, maxY: original.height / longEdge };
}

function nextTaskOutput(
  current: Task["pipeline"]["output"],
  key: string,
  value: unknown,
  settings: GlobalSettings,
  originalFormat: string
): Task["pipeline"]["output"] {
  const nextOutput = applyOutputSettingChange(current, key, value);
  const resolvedFormat = resolveOutputFormat(nextOutput.format, originalFormat);
  if (key === "format") {
    return {
      ...nextOutput,
      quality: defaultQualityForFormat(nextOutput.format, settings, originalFormat, current.quality),
      flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
    };
  }
  if (resolvedFormat !== "jpeg" || (nextOutput.quality === "auto" && originalFormat !== "jpeg")) {
    return {
      ...nextOutput,
      quality: defaultQualityForFormat(nextOutput.format, settings, originalFormat, current.quality),
      flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
    };
  }
  return {
    ...nextOutput,
    flattenTransparency: resolvedFormat === "jpeg" ? true : nextOutput.flattenTransparency
  };
}

function defaultQualityForFormat(
  format: Task["pipeline"]["output"]["format"],
  settings: GlobalSettings,
  originalFormat: string,
  fallback: Task["pipeline"]["output"]["quality"]
): Task["pipeline"]["output"]["quality"] {
  const resolvedFormat = resolveOutputFormat(format, originalFormat);
  if (resolvedFormat === "webp") return settings.defaultWebpQuality;
  if (resolvedFormat === "avif") return settings.defaultAvifQuality;
  if (resolvedFormat === "png") return typeof fallback === "number" ? fallback : 82;
  if (settings.enableJpegQualityEstimate && settings.jpegQualityMode === "auto" && originalFormat === "jpeg") return "auto";
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

function touchTaskMetadata(task: Task): void {
  task.everEdited = true;
  task.updatedAt = nowIso();
  task.error = null;
}

function metadataFieldsWithValues(fields: MetadataFields): MetadataFields {
  const next: MetadataFields = {};
  for (const key of EDITABLE_METADATA_FIELDS) {
    const value = fields[key]?.trim();
    if (value) next[key] = value;
  }
  return next;
}
