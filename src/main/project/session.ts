import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { nowIso } from "@shared/time";
import { defaultPipeline } from "@shared/defaults";
import type { GlobalSettings } from "@shared/types/settings";
import type { Original, Project, Task } from "@shared/types/project";
import { detectFormat } from "@runtime/format";
import { sha256Bytes } from "@runtime/hash";
import { createEmptyProject, loadProject, saveProject } from "@main/persistence/project-io";
import { processTask } from "@main/queues/processing";
import { queueSnapshotFromProject } from "@main/queues/snapshot";
import type { QueueSnapshot, RenamePreview } from "@shared/types/ipc";
import { getOpDefinition } from "@core/ops/catalog";
import { renderOriginalThumbnail, renderTaskPreview, type OriginalThumbnail, type PreviewResult } from "@main/preview/preview-service";
import { previewRename, runRename } from "@main/rename/rename-service";
import type { QualityQueue } from "@main/queues/quality";
import type { VisionQueue } from "@main/queues/vision";
import type { ProcessingQueue } from "@main/queues/processing-queue";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import { resolveOriginalSourcePath } from "./source-resolver";

export type ProjectSessionSnapshot = {
  projectPath: string | null;
  project: Project;
  activeTaskId: string | null;
};

export class ProjectSession {
  #projectPath: string | null = null;
  #project: Project;
  #activeTaskId: string | null = null;
  #taskUndoHistory = new Map<string, Task[]>();
  #snapshotListener: ((snapshot: ProjectSessionSnapshot, queue: QueueSnapshot) => void | Promise<void>) | null = null;

  constructor(
    private readonly settings: GlobalSettings,
    private readonly qualityQueue: QualityQueue | null = null,
    private readonly visionQueue: VisionQueue | null = null,
    private readonly processingQueue: ProcessingQueue | null = null,
    private readonly workerPool: PipelineWorkerPool | null = null
  ) {
    this.#project = createEmptyProject("Untitled Project", settings.defaultOutputDirectory);
  }

  snapshot(): ProjectSessionSnapshot {
    return {
      projectPath: this.#projectPath,
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

  async newProject(name = "Untitled Project"): Promise<ProjectSessionSnapshot> {
    this.#projectPath = null;
    this.#project = createEmptyProject(name, this.settings.defaultOutputDirectory);
    this.#activeTaskId = null;
    this.#taskUndoHistory.clear();
    return this.snapshot();
  }

  async open(projectPath: string): Promise<ProjectSessionSnapshot> {
    const loaded = await loadProject(projectPath);
    this.#projectPath = loaded.path;
    this.#project = loaded.project;
    this.#taskUndoHistory.clear();
    await this.recoverProjectQueues();
    this.#activeTaskId = this.#project.tasks[0]?.id ?? null;
    await this.persistIfSaved();
    return this.snapshot();
  }

  async openLastProjectIfAvailable(): Promise<void> {
    if (!this.settings.lastProjectPath) return;
    try {
      await this.open(this.settings.lastProjectPath);
    } catch {
      this.settings.lastProjectPath = null;
    }
  }

  async saveAs(projectPath: string): Promise<ProjectSessionSnapshot> {
    await saveProject(projectPath, this.#project);
    this.#projectPath = projectPath;
    return this.snapshot();
  }

  async setOutputDir(outputDir: string): Promise<ProjectSessionSnapshot> {
    this.#project.outputDir = outputDir;
    await this.persistIfSaved();
    return this.snapshot();
  }

  async addOriginals(sourcePaths: string[]): Promise<ProjectSessionSnapshot> {
    for (const sourcePath of sourcePaths) {
      const original = await buildOriginal(sourcePath);
      const existing = this.#project.originals.find((item) => item.sourceHash === original.sourceHash);
      const targetOriginal = existing ?? original;

      if (!existing) {
        this.#project.originals.push(original);
        await this.qualityQueue?.enqueueOriginal(original);
      }

      await this.selectOriginal(targetOriginal.id);
    }

    await this.persistIfSaved();
    return this.snapshot();
  }

  async selectOriginal(originalId: string): Promise<ProjectSessionSnapshot> {
    const original = this.#project.originals.find((item) => item.id === originalId);
    if (!original) {
      throw new Error(`Original not found: ${originalId}`);
    }

    const activeTask = this.#activeTaskId ? this.#project.tasks.find((task) => task.id === this.#activeTaskId) : null;
    if (activeTask && isUntouchedTask(activeTask)) {
      activeTask.originalId = original.id;
      activeTask.updatedAt = nowIso();
      await this.persistIfSaved();
      return this.snapshot();
    }

    const task = createTaskForOriginal(original.id, this.settings);
    this.#project.tasks.push(task);
    this.#activeTaskId = task.id;
    await this.persistIfSaved();
    return this.snapshot();
  }

  async selectTask(taskId: string): Promise<ProjectSessionSnapshot> {
    if (!this.#project.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.#activeTaskId = taskId;
    await this.persistIfSaved();
    return this.snapshot();
  }

  async forkTask(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const fork = createTaskForOriginal(task.originalId, this.settings);
    fork.pipeline = structuredClone(task.pipeline);
    this.#project.tasks.push(fork);
    this.#activeTaskId = fork.id;
    await this.persistIfSaved();
    return this.snapshot();
  }

  async deleteTask(taskId: string): Promise<ProjectSessionSnapshot> {
    const index = this.#project.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.#project.tasks.splice(index, 1);
    this.#taskUndoHistory.delete(taskId);
    if (this.#activeTaskId === taskId) {
      this.#activeTaskId = this.#project.tasks[index]?.id ?? this.#project.tasks[index - 1]?.id ?? null;
    }
    await this.persistIfSaved();
    return this.snapshot();
  }

  async dismissTaskError(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.error = null;
    if (task.status === "error") {
      task.status = "pending";
    }
    task.updatedAt = nowIso();
    await this.persistIfSaved();
    return this.snapshot();
  }

  async retryTask(taskId: string): Promise<ProjectSessionSnapshot> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.error?.stage === "vision" && task.status === "done") {
      task.error = null;
      await this.runVision(taskId);
      return this.snapshot();
    }

    task.status = "pending";
    task.error = null;
    task.output = null;
    task.updatedAt = nowIso();
    await this.saveTask(taskId);
    return this.snapshot();
  }

  async saveTask(taskId: string): Promise<ProjectSessionSnapshot> {
    if (this.processingQueue) {
      await this.processingQueue.runTask(this.#project, taskId, this.#projectPath);
    } else {
      await processTask(this.#project, taskId, this.#projectPath, this.settings, await this.sourceFactsForTask(taskId), undefined, this.workerPool);
    }
    await this.runVisionIfNeeded(taskId);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async saveAllPending(): Promise<ProjectSessionSnapshot> {
    const pendingTaskIds = this.#project.tasks.filter((task) => task.status === "pending").map((task) => task.id);
    if (this.processingQueue) {
      await this.processingQueue.runPending(this.#project, this.#projectPath);
    } else {
      for (const taskId of pendingTaskIds) {
        await processTask(this.#project, taskId, this.#projectPath, this.settings, await this.sourceFactsForTask(taskId), undefined, this.workerPool);
      }
    }
    for (const taskId of pendingTaskIds) {
      await this.runVisionIfNeeded(taskId);
    }

    await this.persistIfSaved();
    return this.snapshot();
  }

  queueSnapshot(): QueueSnapshot {
    if (this.processingQueue) {
      return this.processingQueue.snapshot(this.#project);
    }
    return queueSnapshotFromProject(this.#project);
  }

  async renderPreview(taskId: string): Promise<PreviewResult> {
    await this.ensureTaskSourcePath(taskId);
    return renderTaskPreview(this.#project, taskId, this.settings.previewLongEdge, this.workerPool);
  }

  async renderOriginalThumbnail(originalId: string): Promise<OriginalThumbnail> {
    const original = this.#project.originals.find((item) => item.id === originalId);
    if (!original) {
      throw new Error(`Original not found: ${originalId}`);
    }
    await this.ensureOriginalSourcePath(original);
    return renderOriginalThumbnail(original);
  }

  async addOp(taskId: string, opType: string): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    const definition = getOpDefinition(opType);
    if (!definition || !definition.visible) {
      throw new Error(`Unknown editable op: ${opType}`);
    }
    this.recordTaskEdit(task);

    task.pipeline.ops.push({
      type: definition.type,
      params: structuredClone(definition.defaultParams),
      enabled: true
    });
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async removeOp(taskId: string, opIndex: number): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    assertOpIndex(task, opIndex);
    this.recordTaskEdit(task);
    task.pipeline.ops.splice(opIndex, 1);
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async setOpEnabled(taskId: string, opIndex: number, enabled: boolean): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    assertOpIndex(task, opIndex);
    this.recordTaskEdit(task);
    task.pipeline.ops[opIndex].enabled = enabled;
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async updateOpParam(taskId: string, opIndex: number, key: string, value: unknown): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    assertOpIndex(task, opIndex);
    this.recordTaskEdit(task);
    task.pipeline.ops[opIndex].params[key] = value;
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async setAnalyzeContent(taskId: string, analyzeContent: boolean): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.analyzeContent = analyzeContent;
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async setCustomSlug(taskId: string, customSlug: string | null): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.customSlug = customSlug && customSlug.trim().length > 0 ? customSlug : null;
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async updateOutput(taskId: string, key: string, value: unknown): Promise<ProjectSessionSnapshot> {
    const task = this.editableTask(taskId);
    this.recordTaskEdit(task);
    task.pipeline.output = {
      ...task.pipeline.output,
      [key]: value
    };
    touchTask(task);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async undoTaskEdit(taskId: string): Promise<ProjectSessionSnapshot> {
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
    await this.persistIfSaved();
    return this.snapshot();
  }

  async previewRename(templateId?: string, taskIds?: string[]): Promise<RenamePreview> {
    return previewRename(this.#project, this.settings, templateId, taskIds);
  }

  async runRename(templateId?: string, taskIds?: string[]): Promise<ProjectSessionSnapshot> {
    await runRename(this.#project, this.settings, templateId, taskIds);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async runVision(taskId: string): Promise<ProjectSessionSnapshot> {
    if (!this.visionQueue) {
      throw new Error("Vision queue is not configured.");
    }
    await this.visionQueue.runForTask(this.#project, taskId);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    if (!this.visionQueue) {
      throw new Error("Vision queue is not configured.");
    }
    await this.visionQueue.setGeminiApiKey(apiKey);
  }

  private async persistIfSaved(): Promise<void> {
    if (this.#projectPath) {
      await saveProject(this.#projectPath, this.#project);
    }
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

  private async runVisionIfNeeded(taskId: string): Promise<void> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    if (task?.status === "done" && task.analyzeContent && task.output && !task.output.vision) {
      await this.visionQueue?.runForTask(this.#project, taskId);
    }
  }

  private async sourceFactsForTask(taskId: string) {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    const original = task ? this.#project.originals.find((item) => item.id === task.originalId) : null;
    if (original) await this.ensureOriginalSourcePath(original);
    return original ? await this.qualityQueue?.factsForOriginal(original) ?? null : null;
  }

  private async ensureTaskSourcePath(taskId: string): Promise<void> {
    const task = this.#project.tasks.find((item) => item.id === taskId);
    const original = task ? this.#project.originals.find((item) => item.id === task.originalId) : null;
    if (!original) return;
    await this.ensureOriginalSourcePath(original);
  }

  private async ensureOriginalSourcePath(original: Original): Promise<void> {
    const previousPath = original.sourcePath;
    await resolveOriginalSourcePath(original, { projectPath: this.#projectPath, outputDir: this.#project.outputDir });
    if (original.sourcePath !== previousPath) {
      await this.persistIfSaved();
    }
  }

  private async recoverProjectQueues(): Promise<void> {
    for (const task of this.#project.tasks) {
      if (task.status === "processing") {
        task.status = "pending";
        task.updatedAt = nowIso();
      }
    }

    const missingVisionTaskIds = this.#project.tasks
      .filter((task) => task.status === "done" && task.analyzeContent && task.output && !task.output.vision)
      .map((task) => task.id);

    for (const taskId of missingVisionTaskIds) {
      await this.visionQueue?.runForTask(this.#project, taskId);
    }
  }
}

async function buildOriginal(sourcePath: string): Promise<Original> {
  const bytes = await fs.readFile(sourcePath);
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();

  return {
    id: nanoid(),
    sourcePath: path.resolve(sourcePath),
    sourceHash: sha256Bytes(bytes),
    size: bytes.byteLength,
    format: detectFormat(bytes),
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    addedAt: nowIso()
  };
}

function createTaskForOriginal(originalId: string, settings: GlobalSettings): Task {
  const now = nowIso();
  const pipeline = defaultPipeline();
  pipeline.output = {
    ...pipeline.output,
    format: settings.defaultOutputFormat,
    quality: settings.defaultOutputFormat === "webp" ? settings.defaultWebpQuality : pipeline.output.quality,
    jpegProgressive: settings.jpegProgressive,
    jpegChromaSubsampling: settings.jpegChromaSubsampling,
    webpMethod: settings.webpMethod,
    avifEffort: settings.avifEffort,
    pngPalette: settings.defaultPngPalette,
    backgroundForTransparency: settings.defaultBackgroundForTransparency,
    iccOutput: settings.outputIccBehavior
  };

  return {
    id: nanoid(),
    originalId,
    analyzeContent: settings.defaultAnalyzeContent,
    outputFormatOverride: null,
    outputQualityOverride: null,
    metadataStripOverride: null,
    customSlug: null,
    pipeline,
    status: "pending",
    output: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

function isUntouchedTask(task: Task): boolean {
  return task.status === "pending" && task.pipeline.ops.length === 0 && task.output === null && task.error === null;
}

function assertOpIndex(task: Task, opIndex: number): void {
  if (!Number.isInteger(opIndex) || opIndex < 0 || opIndex >= task.pipeline.ops.length) {
    throw new Error(`Op index out of range: ${opIndex}`);
  }
}

function touchTask(task: Task): void {
  task.updatedAt = nowIso();
  task.output = null;
  task.error = null;
}
