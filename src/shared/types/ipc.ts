import type { GlobalSettings } from "./settings";
import type { UiState } from "./state";
import type { Project } from "./project";
import type { VisionRunMode } from "./project";
import type { OpDefinition } from "./op";
import type { RenameTemplateId } from "../rename-template";

export type { VisionRunMode } from "./project";

export type QueueSnapshot = {
  saved: number;
  total: number;
  notSaved: number;
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
  lutsDir: string;
  stampsDir: string;
  cpuCount: number;
  /** `process.platform` of the host running the app, used for runtime-correct UI (e.g. shortcut labels). */
  platform: NodeProcessPlatform;
};

/**
 * The values `process.platform` can take. Declared explicitly (rather than as
 * `NodeJS.Platform`) so this shared type stays usable from the renderer's
 * web-only typecheck, which does not load Node's ambient types.
 */
export type NodeProcessPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

/**
 * A structured log object the sandboxed renderer forwards to the main process,
 * which owns the session file. The renderer only ever surfaces problems it
 * recovered from (captured `console.warn`/`console.error`) or last-resort global
 * hooks, so the level is restricted to `warn`/`error`. Main stamps the source
 * and runs the fields through the same redactor as its own logs.
 */
export type RendererLogEntry = {
  level: "warn" | "error";
  message: string;
  fields?: Record<string, unknown>;
};

export type PrivacyWarning = {
  kept: ("editorial" | "dates" | "gps")[];
};

export type ProjectSnapshot = {
  project: Project;
  activeTaskId: string | null;
  privacyWarnings: Record<string, PrivacyWarning>;
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

export type VisionRunOptions = {
  mode?: VisionRunMode;
};

export type OriginalThumbnail = {
  originalId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type AssetThumbnail = {
  dataUrl: string;
  width: number;
  height: number;
};

export type RenamePreviewItem = {
  taskId: string;
  originalName: string;
  status: "not-saved" | "unchanged" | "ready" | "blocked";
  currentPath: string | null;
  proposedPath: string | null;
  currentName: string | null;
  proposedName: string | null;
  missingSlug: boolean;
  customSlug: string | null;
  generatedSlug: string | null;
  effectiveSlug: string | null;
  issue: string | null;
};

export type RenamePreview = {
  templateId: RenameTemplateId;
  usesOriginal: boolean;
  usesSlug: boolean;
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
  builtin: boolean;
};

export type AssetImportResult = {
  fileName: string;
  path: string;
  status: "imported" | "skipped-name-conflict";
};

export type LutPreviewEntry = LutEntry & {
  dataUrl: string;
  width: number;
  height: number;
};

export type CloseRequest = {
  mode: "window" | "quit";
};

export type ProjectEventName = "project.snapshot" | "queue.snapshot";

export type TaskEditOptions = {
  historyGroup?: string;
};

export type FotoReadyApi = {
  system: {
    getInfo(): Promise<SystemInfo>;
    filePathForFile(file: File): string;
    log(entry: RendererLogEntry): Promise<void>;
    openExternal(url: string): Promise<void>;
    pickFile(options: { title: string; extensions: string[] }): Promise<string | null>;
    pickFiles(options: { title: string; extensions: string[] }): Promise<string[]>;
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
    delete(taskId: string): Promise<ProjectSnapshot>;
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
    updateOpParam(taskId: string, opId: string, key: string, value: unknown, options?: TaskEditOptions): Promise<ProjectSnapshot>;
    updateOpParams(taskId: string, opId: string, patch: Record<string, unknown>, options?: TaskEditOptions): Promise<ProjectSnapshot>;
    undo(taskId: string): Promise<ProjectSnapshot>;
    setGenerateDescription(taskId: string, generateDescription: boolean): Promise<ProjectSnapshot>;
    setGenerateSlug(taskId: string, generateSlug: boolean): Promise<ProjectSnapshot>;
    setCustomSlug(taskId: string, customSlug: string | null): Promise<ProjectSnapshot>;
    clearVision(taskId: string): Promise<ProjectSnapshot>;
    updateOutput(taskId: string, key: string, value: unknown, options?: TaskEditOptions): Promise<ProjectSnapshot>;
  };
  ops: {
    list(): Promise<OpCatalogItem[]>;
  };
  assets: {
    aspectRatio(assetPath: string): Promise<number>;
    thumbnail(assetPath: string, longEdge?: number): Promise<AssetThumbnail>;
  };
  preview: {
    render(taskId: string, options?: PreviewRenderOptions): Promise<PreviewResult>;
    originalThumbnail(originalId: string): Promise<OriginalThumbnail>;
  };
  vision: {
    runForTask(taskId: string, options?: VisionRunOptions): Promise<ProjectSnapshot>;
  };
  rename: {
    preview(templateId?: RenameTemplateId, taskIds?: string[]): Promise<RenamePreview>;
    run(templateId?: RenameTemplateId, taskIds?: string[]): Promise<ProjectSnapshot>;
  };
  luts: {
    list(): Promise<LutEntry[]>;
    import(filePaths: string[]): Promise<AssetImportResult[]>;
    delete(filePaths: string[]): Promise<void>;
    preview(taskId: string, options: PreviewRenderOptions | undefined, strength: number, previewLongEdge: number): Promise<LutPreviewEntry[]>;
  };
  stamps: {
    list(): Promise<StampEntry[]>;
    import(filePaths: string[]): Promise<AssetImportResult[]>;
    delete(filePaths: string[]): Promise<void>;
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
