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
import type { QueueSnapshot } from "@shared/types/ipc";

export type ProjectSessionSnapshot = {
  projectPath: string | null;
  project: Project;
  activeTaskId: string | null;
};

export class ProjectSession {
  #projectPath: string | null = null;
  #project: Project;
  #activeTaskId: string | null = null;

  constructor(private readonly settings: GlobalSettings) {
    this.#project = createEmptyProject("Untitled Project", settings.defaultOutputDirectory);
  }

  snapshot(): ProjectSessionSnapshot {
    return {
      projectPath: this.#projectPath,
      project: this.#project,
      activeTaskId: this.#activeTaskId
    };
  }

  async newProject(name = "Untitled Project"): Promise<ProjectSessionSnapshot> {
    this.#projectPath = null;
    this.#project = createEmptyProject(name, this.settings.defaultOutputDirectory);
    this.#activeTaskId = null;
    return this.snapshot();
  }

  async open(projectPath: string): Promise<ProjectSessionSnapshot> {
    const loaded = await loadProject(projectPath);
    this.#projectPath = loaded.path;
    this.#project = loaded.project;
    this.#activeTaskId = this.#project.tasks[0]?.id ?? null;
    return this.snapshot();
  }

  async saveAs(projectPath: string): Promise<ProjectSessionSnapshot> {
    await saveProject(projectPath, this.#project);
    this.#projectPath = projectPath;
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

  async saveTask(taskId: string): Promise<ProjectSessionSnapshot> {
    await processTask(this.#project, taskId, this.#projectPath);
    await this.persistIfSaved();
    return this.snapshot();
  }

  async saveAllPending(): Promise<ProjectSessionSnapshot> {
    const pendingTaskIds = this.#project.tasks
      .filter((task) => task.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => task.id);

    for (const taskId of pendingTaskIds) {
      await processTask(this.#project, taskId, this.#projectPath);
    }

    await this.persistIfSaved();
    return this.snapshot();
  }

  queueSnapshot(): QueueSnapshot {
    return queueSnapshotFromProject(this.#project);
  }

  private async persistIfSaved(): Promise<void> {
    if (this.#projectPath) {
      await saveProject(this.#projectPath, this.#project);
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
