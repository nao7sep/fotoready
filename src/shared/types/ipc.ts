import type { GlobalSettings } from "./settings";
import type { UiState } from "./state";
import type { Project } from "./project";
import type { OpDefinition } from "./op";

export type QueueSnapshot = {
  done: number;
  total: number;
  pending: number;
  queued: number;
  processing: number;
  errors: number;
  activeTaskId: string | null;
  activeTaskLabel: string | null;
};

export type SystemInfo = {
  appName: "FotoReady";
  version: string;
  dataDir: string;
  cpuCount: number;
};

export type ProjectSnapshot = {
  project: Project;
  activeTaskId: string | null;
};

export type OpCatalogItem = Pick<OpDefinition, "type" | "label" | "pickerLabel" | "category" | "defaultParams" | "previewBehavior" | "metadataOnly">;

export type PreviewResult = {
  taskId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type PreviewRenderMode = "input" | "output" | "full";

export type PreviewRenderOptions = {
  targetOpId?: string | null;
  mode?: PreviewRenderMode;
};

export type VisionRunMode = "description" | "description-and-slug" | "slug";

export type VisionRunOptions = {
  mode?: VisionRunMode;
};

export type OriginalThumbnail = {
  originalId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type RenamePreviewItem = {
  taskId: string;
  label: string;
  status: "not-saved" | "unchanged" | "ready" | "blocked";
  currentPath: string | null;
  proposedPath: string | null;
  currentName: string | null;
  proposedName: string | null;
  missingSlug: boolean;
  issue: string | null;
};

export type RenamePreview = {
  templateId: string;
  items: RenamePreviewItem[];
  renameableCount: number;
  blockedCount: number;
  missingSlugCount: number;
};

export type LutEntry = {
  name: string;
  path: string;
  builtin: boolean;
};

export type StampEntry = {
  name: string;
  path: string;
  format: "png" | "svg";
};

export type CloseRequest = {
  mode: "window" | "quit";
};

export type ProjectEventName = "project.snapshot" | "queue.snapshot";

export type TaskDeleteOptions = {
  deleteStagedOutput?: boolean;
  deleteFinalOutput?: boolean;
};

export type FotoReadyApi = {
  system: {
    getInfo(): Promise<SystemInfo>;
    filePathForFile(file: File): string;
    log(level: "warn" | "error", message: string, detail?: string | null): Promise<void>;
    openExternal(url: string): Promise<void>;
    pickFile(options: { title: string; extensions: string[] }): Promise<string | null>;
    pickDirectory(options: { title: string }): Promise<string | null>;
    revealInFolder(filePath: string): Promise<void>;
  };
  settings: {
    get(): Promise<GlobalSettings>;
    update(patch: Partial<GlobalSettings>): Promise<GlobalSettings>;
    hasGeminiApiKey(): Promise<boolean>;
    setGeminiApiKey(apiKey: string): Promise<void>;
    clearGeminiApiKey(): Promise<void>;
  };
  state: {
    get(): Promise<UiState>;
    update(patch: Partial<UiState>): Promise<UiState>;
  };
  project: {
    current(): Promise<ProjectSnapshot>;
    setOutputDirFromDialog(): Promise<ProjectSnapshot>;
    clearOutputDir(): Promise<ProjectSnapshot>;
    addOriginals(sourcePaths: string[]): Promise<ProjectSnapshot>;
    addOriginalsFromDialog(): Promise<ProjectSnapshot>;
    removeOriginal(originalId: string): Promise<ProjectSnapshot>;
    selectOriginal(originalId: string): Promise<ProjectSnapshot>;
  };
  task: {
    select(taskId: string): Promise<ProjectSnapshot>;
    fork(taskId: string): Promise<ProjectSnapshot>;
    delete(taskId: string, options?: TaskDeleteOptions): Promise<ProjectSnapshot>;
    deleteSavedOutput(taskId: string): Promise<ProjectSnapshot>;
    dismissError(taskId: string): Promise<ProjectSnapshot>;
    retry(taskId: string): Promise<ProjectSnapshot>;
    save(taskId: string): Promise<ProjectSnapshot>;
    saveAll(): Promise<ProjectSnapshot>;
    cancel(taskId: string): Promise<ProjectSnapshot>;
    cancelAll(): Promise<ProjectSnapshot>;
    addOp(taskId: string, opType: string): Promise<ProjectSnapshot>;
    removeOp(taskId: string, opId: string): Promise<ProjectSnapshot>;
    moveOp(taskId: string, opId: string, toIndex: number): Promise<ProjectSnapshot>;
    setOpEnabled(taskId: string, opId: string, enabled: boolean): Promise<ProjectSnapshot>;
    updateOpParam(taskId: string, opId: string, key: string, value: unknown): Promise<ProjectSnapshot>;
    updateOpParams(taskId: string, opId: string, patch: Record<string, unknown>): Promise<ProjectSnapshot>;
    undo(taskId: string): Promise<ProjectSnapshot>;
    setGenerateDescription(taskId: string, generateDescription: boolean): Promise<ProjectSnapshot>;
    setGenerateSlug(taskId: string, generateSlug: boolean): Promise<ProjectSnapshot>;
    setCustomSlug(taskId: string, customSlug: string | null): Promise<ProjectSnapshot>;
    clearVision(taskId: string): Promise<ProjectSnapshot>;
    updateOutput(taskId: string, key: string, value: unknown): Promise<ProjectSnapshot>;
  };
  ops: {
    list(): Promise<OpCatalogItem[]>;
  };
  assets: {
    aspectRatio(assetPath: string): Promise<number>;
  };
  preview: {
    render(taskId: string, options?: PreviewRenderOptions): Promise<PreviewResult>;
    originalThumbnail(originalId: string): Promise<OriginalThumbnail>;
  };
  vision: {
    runForTask(taskId: string, options?: VisionRunOptions): Promise<ProjectSnapshot>;
  };
  rename: {
    preview(templateId?: string, taskIds?: string[]): Promise<RenamePreview>;
    run(templateId?: string, taskIds?: string[]): Promise<ProjectSnapshot>;
  };
  luts: {
    list(): Promise<LutEntry[]>;
    import(filePath: string): Promise<LutEntry>;
  };
  stamps: {
    list(): Promise<StampEntry[]>;
    import(filePath: string): Promise<StampEntry>;
  };
  queues: {
    snapshot(): Promise<QueueSnapshot>;
  };
  lifecycle: {
    approveClose(allow: boolean): Promise<void>;
    onCloseRequest(callback: (request: CloseRequest) => void): () => void;
  };
  events: {
    onProjectSnapshot(callback: (snapshot: ProjectSnapshot) => void): () => void;
    onQueueSnapshot(callback: (snapshot: QueueSnapshot) => void): () => void;
  };
};
