import type { GlobalSettings } from "./settings";
import type { Project } from "./project";
import type { OpDefinition } from "./op";

export type QueueSnapshot = {
  done: number;
  total: number;
  processing: number;
  errors: number;
};

export type SystemInfo = {
  appName: "FotoReady";
  version: string;
  dataDir: string;
};

export type ProjectSnapshot = {
  projectPath: string | null;
  project: Project;
  activeTaskId: string | null;
};

export type OpCatalogItem = Pick<OpDefinition, "type" | "label" | "category" | "defaultParams" | "visible">;

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

export type RenamePreviewItem = {
  taskId: string;
  stagedPath: string;
  proposedPath: string;
  stagedName: string;
  proposedName: string;
  missingSlug: boolean;
};

export type RenamePreview = {
  templateId: string;
  items: RenamePreviewItem[];
  missingSlugCount: number;
};

export type CacheSizes = {
  sourceFactsBytes: number;
  visionFactsBytes: number;
};

export type ProjectEventName = "project.snapshot" | "queue.snapshot";

export type FotoReadyApi = {
  system: {
    getInfo(): Promise<SystemInfo>;
    pickFile(options: { title: string; extensions: string[] }): Promise<string | null>;
    revealInFolder(filePath: string): Promise<void>;
  };
  settings: {
    get(): Promise<GlobalSettings>;
    update(patch: Partial<GlobalSettings>): Promise<GlobalSettings>;
    setGeminiApiKey(apiKey: string): Promise<void>;
  };
  project: {
    current(): Promise<ProjectSnapshot>;
    newProject(name?: string): Promise<ProjectSnapshot>;
    openFromDialog(): Promise<ProjectSnapshot>;
    saveAsFromDialog(): Promise<ProjectSnapshot>;
    setOutputDirFromDialog(): Promise<ProjectSnapshot>;
    addOriginalsFromDialog(): Promise<ProjectSnapshot>;
    selectOriginal(originalId: string): Promise<ProjectSnapshot>;
  };
  task: {
    select(taskId: string): Promise<ProjectSnapshot>;
    fork(taskId: string): Promise<ProjectSnapshot>;
    delete(taskId: string): Promise<ProjectSnapshot>;
    dismissError(taskId: string): Promise<ProjectSnapshot>;
    retry(taskId: string): Promise<ProjectSnapshot>;
    save(taskId: string): Promise<ProjectSnapshot>;
    saveAll(): Promise<ProjectSnapshot>;
    addOp(taskId: string, opType: string): Promise<ProjectSnapshot>;
    removeOp(taskId: string, opIndex: number): Promise<ProjectSnapshot>;
    setOpEnabled(taskId: string, opIndex: number, enabled: boolean): Promise<ProjectSnapshot>;
    updateOpParam(taskId: string, opIndex: number, key: string, value: unknown): Promise<ProjectSnapshot>;
    undo(taskId: string): Promise<ProjectSnapshot>;
    setAnalyzeContent(taskId: string, analyzeContent: boolean): Promise<ProjectSnapshot>;
    setCustomSlug(taskId: string, customSlug: string | null): Promise<ProjectSnapshot>;
    updateOutput(taskId: string, key: string, value: unknown): Promise<ProjectSnapshot>;
  };
  ops: {
    list(): Promise<OpCatalogItem[]>;
  };
  preview: {
    render(taskId: string): Promise<PreviewResult>;
    originalThumbnail(originalId: string): Promise<OriginalThumbnail>;
  };
  vision: {
    runForTask(taskId: string): Promise<ProjectSnapshot>;
  };
  rename: {
    preview(templateId?: string, taskIds?: string[]): Promise<RenamePreview>;
    run(templateId?: string, taskIds?: string[]): Promise<ProjectSnapshot>;
  };
  caches: {
    sizes(): Promise<CacheSizes>;
    clear(): Promise<CacheSizes>;
  };
  queues: {
    snapshot(): Promise<QueueSnapshot>;
  };
  events: {
    onProjectSnapshot(callback: (snapshot: ProjectSnapshot) => void): () => void;
    onQueueSnapshot(callback: (snapshot: QueueSnapshot) => void): () => void;
  };
};
