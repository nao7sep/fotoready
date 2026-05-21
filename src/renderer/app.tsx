import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, CopyPlus, Menu, Save, Trash2, X } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import type { LutEntry, OpCatalogItem, PreviewRenderMode, PreviewResult, ProjectSnapshot, QueueSnapshot, StampEntry, SystemInfo } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import { APP_NAME } from "@shared/constants";
import { formatLabel, resolveOutputFormat } from "@shared/output-format";
import { pipelineForPreview } from "@shared/preview-pipeline";
import { EditorCanvas } from "./components/canvas/editor-canvas";
import { HistogramOverlay } from "./components/canvas/histogram-overlay";
import { RenameModal } from "./components/modals/rename-modal";
import { AppSettingsModal } from "./components/modals/settings-modal";
import { ModalShell } from "./components/modals/modal-shell";
import { ConfirmerProvider, useConfirmer } from "./components/modals/confirmer";
import { OpsPanel } from "./components/panels/ops-panel";
import { OriginalsPanel } from "./components/panels/originals-panel";
import { TasksPanel } from "./components/panels/tasks-panel";
import { useWorkspaceLayout } from "./layout/workspace-layout";
import type { ImageFitMode } from "./ops/_overlay-primitives";
import { useEditorStore } from "./state/editor-store";
import "./styles/app.css";

const initialQueueSnapshot: QueueSnapshot = {
  done: 0,
  total: 0,
  pending: 0,
  queued: 0,
  processing: 0,
  errors: 0,
  activeTaskId: null,
  activeTaskLabel: null
};

const APP_REPOSITORY_URL = "https://github.com/nao7sep/fotoready";
const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

type ShortcutItem = {
  action: string;
  detail?: string;
  keys: string;
};

const SHORTCUT_SECTIONS: ReadonlyArray<{ title: string; items: ReadonlyArray<ShortcutItem> }> = [
  {
    title: "Import and save",
    items: [
      { action: "Add originals", detail: "Open the file picker to import source images or sidecars.", keys: "Cmd/Ctrl+N" },
      { action: "Save current pending image", detail: "Apply the current task's ops, queue processing, and write the output image plus sidecar.", keys: "Cmd/Ctrl+S" },
      { action: "Save all pending images", detail: "Queue every pending task for processing and output.", keys: "Cmd/Ctrl+Shift+S" },
      { action: "Rename all", detail: "Review saved and unsaved tasks before renaming saved outputs.", keys: "Cmd/Ctrl+R" }
    ]
  },
  {
    title: "Editing",
    items: [
      { action: "Undo last pending-task edit", detail: "Revert the most recent task edit, including op changes, params, output settings, and slug/generation toggles.", keys: "Cmd/Ctrl+Z" }
    ]
  },
  {
    title: "View",
    items: [
      { action: "Toggle histogram", detail: "Show or hide the preview histogram. Its position is remembered across sessions.", keys: "Cmd/Ctrl+H" }
    ]
  },
  {
    title: "App",
    items: [
      { action: "Open settings", keys: "Cmd/Ctrl+," },
      { action: "Show keyboard shortcuts", keys: "Cmd/Ctrl+/" },
      { action: "Close the active dialog", keys: "Esc" }
    ]
  }
];

function App(): React.JSX.Element {
  const confirmer = useConfirmer();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [uiState, setUiState] = useState<UiState | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [lutEntries, setLutEntries] = useState<LutEntry[]>([]);
  const [stampEntries, setStampEntries] = useState<StampEntry[]>([]);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [globalDropActive, setGlobalDropActive] = useState(false);
  const [queue, setQueue] = useState<QueueSnapshot>(initialQueueSnapshot);
  const [pendingRevealOpId, setPendingRevealOpId] = useState<string | null>(null);
  const [visionTaskIds, setVisionTaskIds] = useState<Set<string>>(() => new Set());
  const projectSnapshot = useEditorStore((state) => state.projectSnapshot);
  const setProjectSnapshot = useEditorStore((state) => state.setProjectSnapshot);
  const preview = useEditorStore((state) => state.preview);
  const setPreview = useEditorStore((state) => state.setPreview);
  const previewState = useEditorStore((state) => state.previewState);
  const setPreviewState = useEditorStore((state) => state.setPreviewState);
  const selectedOpId = useEditorStore((state) => state.selectedOpId);
  const selectOp = useEditorStore((state) => state.selectOp);
  const renameOpen = useEditorStore((state) => state.renameOpen);
  const setRenameOpen = useEditorStore((state) => state.setRenameOpen);
  const apiKeyOpen = useEditorStore((state) => state.apiKeyOpen);
  const setApiKeyOpen = useEditorStore((state) => state.setApiKeyOpen);
  const shortcutsOpen = useEditorStore((state) => state.shortcutsOpen);
  const setShortcutsOpen = useEditorStore((state) => state.setShortcutsOpen);
  const aboutOpen = useEditorStore((state) => state.aboutOpen);
  const setAboutOpen = useEditorStore((state) => state.setAboutOpen);
  const menuOpen = useEditorStore((state) => state.menuOpen);
  const setMenuOpen = useEditorStore((state) => state.setMenuOpen);
  const showOriginals = useEditorStore((state) => state.showOriginals);
  const showTasks = useEditorStore((state) => state.showTasks);
  const showOps = useEditorStore((state) => state.showOps);
  const globalDragDepthRef = useRef(0);
  const workspaceLayout = useWorkspaceLayout({ showOps, showOriginals, showTasks });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;
  const showHistogram = uiState?.showHistogram ?? false;
  const outputDirLabel = !project?.outputDir ? "Same as original" : project.outputDir;
  const settingsDirty = Boolean(settingsDraft && settings && JSON.stringify(settingsDraft) !== JSON.stringify(settings));
  const apiKeyDirty = apiKeyDraft.trim().length > 0;
  const activeTaskVisionGenerating = Boolean(activeTask && (
    visionTaskIds.has(activeTask.id)
    || (
      queue.activeTaskId === activeTask.id
      && activeTask.status === "done"
      && Boolean(activeTask.output)
      && !activeTask.output?.vision
      && Boolean(activeTask.generateDescription || activeTask.generateSlug)
      && hasGeminiApiKey
    )
  ));
  const opCatalogByType = useMemo(() => new Map(opCatalog.map((item) => [item.type, item])), [opCatalog]);
  const previewConfig = useMemo(() => {
    if (!activeTask) return null;
    const selectedOp = selectedOpId ? activeTask.pipeline.ops.find((op) => op.id === selectedOpId) ?? null : null;
    // Cards with previewBehavior "show-input" (currently crop) display
    // the image *before* their own op so the overlay rectangle lines up with the unaltered base.
    // Other cards include themselves so slider edits appear live.
    const selectedDefinition = selectedOp ? opCatalogByType.get(selectedOp.type) ?? null : null;
    const mode: PreviewRenderMode = selectedOp ? selectedDefinition?.previewBehavior === "show-input" ? "input" : "output" : "full";
    const options = mode === "full" || !selectedOp ? undefined : { targetOpId: selectedOp.id, mode };
    const previewPipeline = pipelineForPreview(activeTask.pipeline, options);
    const previewPixelOps = previewPipeline.ops.filter((op) => opCatalogByType.get(op.type)?.metadataOnly !== true);
    const previewStateKey = JSON.stringify({
      taskId: activeTask.id,
      originalHash: activeOriginal?.sourceHash ?? null,
      previewLongEdge: settings?.previewLongEdge ?? null,
      ops: previewPixelOps
    });
    return {
      taskId: activeTask.id,
      options,
      previewStateKey,
      previewScaleMode: ((selectedOp?.enabled && selectedOp.type === "resize") ? "shrink-only" : "fit") as ImageFitMode
    };
  }, [activeOriginal?.sourceHash, activeTask, opCatalogByType, selectedOpId, settings?.previewLongEdge]);
  const previewRequest = previewConfig ? { taskId: previewConfig.taskId, options: previewConfig.options, previewStateKey: previewConfig.previewStateKey } : null;
  const previewScaleMode: ImageFitMode = previewConfig?.previewScaleMode ?? "fit";
  const previewStateKey = previewRequest?.previewStateKey ?? null;

  useEffect(() => {
    void Promise.all([
      api.system.getInfo(),
      api.settings.get(),
      api.state.get(),
      api.settings.hasGeminiApiKey(),
      api.project.current(),
      api.ops.list(),
      api.queues.snapshot(),
      api.luts.list(),
      api.stamps.list()
    ]).then(
      ([info, loadedSettings, loadedState, geminiKeyConfigured, loadedProject, loadedOps, snapshot, loadedLuts, loadedStamps]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setUiState(loadedState);
        setHasGeminiApiKey(geminiKeyConfigured);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
        setLutEntries(loadedLuts);
        setStampEntries(loadedStamps);
      }
    );
  }, []);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      void api.system.log("warn", stringifyLogArgs(args));
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      void api.system.log("error", stringifyLogArgs(args));
    };
    const onError = (event: ErrorEvent) => void api.system.log("error", event.message, event.error instanceof Error ? event.error.stack ?? null : null);
    const onRejection = (event: PromiseRejectionEvent) => void api.system.log("error", "Unhandled renderer rejection", stringifyLogArgs([event.reason]));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void addOriginals();
      } else if (mod && event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAll();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTask?.status === "pending") void saveTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        if (activeTask?.status === "pending") void undoTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (project?.tasks.some((task) => task.status === "done")) setRenameOpen(true);
      } else if (mod && event.key === ",") {
        event.preventDefault();
        void openSettings();
      } else if (mod && (event.key === "/" || event.key === "?")) {
        event.preventDefault();
        setMenuOpen(false);
        setShortcutsOpen(true);
      } else if (mod && event.key.toLowerCase() === "h") {
        event.preventDefault();
        void toggleHistogram();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTask?.id, activeTask?.status, project?.tasks, uiState?.showHistogram]);

  useEffect(() => {
    const offProject = api.events.onProjectSnapshot((snapshot) => {
      setProjectSnapshot(snapshot);
    });
    const offQueue = api.events.onQueueSnapshot((snapshot) => {
      setQueue(snapshot);
    });
    return () => {
      offProject();
      offQueue();
    };
  }, []);

  useEffect(() => {
    if (!previewRequest) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    setPreview(null);
    setPreviewState("loading");
    timeoutId = window.setTimeout(() => {
      void api.preview.render(previewRequest.taskId, previewRequest.options)
        .then((result) => {
          if (!cancelled) {
            setPreview(result);
            setPreviewState("idle");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreview(null);
            setPreviewState("error");
          }
        });
    }, settings?.previewDebounceMs ?? 0);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [previewStateKey, settings?.previewDebounceMs]);

  useEffect(() => {
    const originals = project?.originals ?? [];
    const missing = originals.filter((original) => !originalThumbnails[original.id]);
    if (missing.length === 0) return;

    let cancelled = false;
    for (const original of missing) {
      void api.preview.originalThumbnail(original.id)
        .then((thumbnail) => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [thumbnail.originalId]: thumbnail.dataUrl }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [original.id]: "" }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [project?.originals, originalThumbnails]);

  async function addOriginals(): Promise<void> {
    await refreshProject(await api.project.addOriginalsFromDialog());
  }

  async function addOriginalPaths(sourcePaths: string[]): Promise<void> {
    if (sourcePaths.length === 0) return;
    await refreshProject(await api.project.addOriginals(sourcePaths));
  }

  async function setOutputDir(): Promise<void> {
    await refreshProject(await api.project.setOutputDirFromDialog());
  }

  async function clearOutputDir(): Promise<void> {
    await refreshProject(await api.project.clearOutputDir());
  }

  async function selectOriginal(originalId: string): Promise<void> {
    await refreshProject(await api.project.selectOriginal(originalId));
  }

  async function removeOriginal(originalId: string): Promise<void> {
    const taskCount = project?.tasks.filter((task) => task.originalId === originalId).length ?? 0;
    if (settings?.confirmDeleteOriginals) {
      const confirmed = await confirmer.confirm({
        title: "Remove original?",
        message: `This removes the original from the app and also removes ${taskCount} related task${taskCount === 1 ? "" : "s"}. The source file on disk is not deleted.`,
        confirmLabel: "Remove",
        danger: false
      });
      if (!confirmed) return;
    }
    await refreshProject(await api.project.removeOriginal(originalId));
    setOriginalThumbnails((current) => {
      const next = { ...current };
      delete next[originalId];
      return next;
    });
  }

  async function selectTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.select(taskId));
  }

  async function forkTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.fork(taskId));
  }

  async function deleteTask(task: Task): Promise<void> {
    try {
      if (settings?.confirmDeleteTasks) {
        const confirmed = await confirmer.confirm({
          title: "Delete task?",
          message: "This removes the task from the app. Saved files on disk are kept.",
          confirmLabel: "Delete"
        });
        if (!confirmed) return;
      }
      await refreshProject(await api.task.delete(task.id));
    } catch (error) {
      console.error(error);
      await confirmer.alert({
        title: "Couldn't delete task",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function deleteSavedOutput(task: Task): Promise<void> {
    if (!task.output) return;
    if (settings?.confirmDeleteOutputFiles) {
      const confirmed = await confirmer.confirm({
        title: "Delete saved files?",
        message: task.output.finalPath ?? task.output.stagedPath,
        confirmLabel: "Delete",
        danger: true
      });
      if (!confirmed) return;
    }
    await refreshProject(await api.task.deleteSavedOutput(task.id));
  }

  async function retryTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.retry(taskId));
  }

  async function dismissError(taskId: string): Promise<void> {
    await refreshProject(await api.task.dismissError(taskId));
  }

  async function undoTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.undo(taskId));
  }

  async function saveTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.save(taskId));
  }

  async function saveAll(): Promise<void> {
    await refreshProject(await api.task.saveAll());
  }

  async function cancelTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.cancel(taskId));
  }

  async function cancelAll(): Promise<void> {
    await refreshProject(await api.task.cancelAll());
  }

  async function addOp(opType: string): Promise<void> {
    if (!activeTask) return;
    const snapshot = await api.task.addOp(activeTask.id, opType);
    await refreshProject(snapshot);
    const addedOpId = snapshot.project.tasks.find((task) => task.id === snapshot.activeTaskId)?.pipeline.ops.at(-1)?.id ?? null;
    selectOp(addedOpId);
    setPendingRevealOpId(addedOpId);
  }

  async function removeOp(opId: string): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.removeOp(activeTask.id, opId));
  }

  async function moveOp(opId: string, toIndex: number): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.moveOp(activeTask.id, opId, toIndex));
  }

  async function setOpEnabled(opId: string, enabled: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setOpEnabled(activeTask.id, opId, enabled));
  }

  async function updateOpParam(opId: string, key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParam(activeTask.id, opId, key, value));
  }

  async function updateOpParams(opId: string, patch: Record<string, unknown>): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParams(activeTask.id, opId, patch));
  }

  async function setGenerateDescription(generateDescription: boolean): Promise<void> {
    const task = activeTask;
    if (!task) return;
    await refreshProject(await api.task.setGenerateDescription(task.id, generateDescription));
    if (generateDescription && task.output && hasGeminiApiKey) {
      await runVisionForTask(task.id);
    }
  }

  async function setGenerateSlug(generateSlug: boolean): Promise<void> {
    const task = activeTask;
    if (!task) return;
    await refreshProject(await api.task.setGenerateSlug(task.id, generateSlug));
    if (generateSlug && task.output && hasGeminiApiKey) {
      await runVisionForTask(task.id, { forceGenerateSlug: true });
    }
  }

  async function setCustomSlug(customSlug: string | null): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setCustomSlug(activeTask.id, customSlug));
  }

  async function generateVision(forceGenerateSlug = false): Promise<void> {
    if (!activeTask?.output) return;
    await runVisionForTask(activeTask.id, { forceGenerateSlug });
  }

  async function clearVision(): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.clearVision(activeTask.id));
  }

  async function runVisionForTask(taskId: string, options?: { forceGenerateSlug?: boolean }): Promise<void> {
    setVisionTaskIds((current) => new Set(current).add(taskId));
    try {
      await refreshProject(await api.vision.runForTask(taskId, options));
    } finally {
      setVisionTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function addDroppedFiles(files: FileList | File[]): Promise<void> {
    const sourcePaths = Array.from(files)
      .map((file) => window.api.system.filePathForFile(file))
      .filter((filePath) => filePath.length > 0);
    if (sourcePaths.length === 0) return;
    await addOriginalPaths(sourcePaths);
  }

  async function openSettings(): Promise<void> {
    setSettingsDraft(settings);
    setApiKeyOpen(true);
  }

  async function saveSettingsDraft(): Promise<void> {
    if (!settingsDraft) return;
    if (apiKeyDraft.trim()) {
      await api.settings.setGeminiApiKey(apiKeyDraft.trim());
      setHasGeminiApiKey(await api.settings.hasGeminiApiKey());
      setApiKeyDraft("");
    }
    if (settingsDirty) {
      setSettings(await api.settings.update(settingsDraft));
    }
    setApiKeyDraft("");
    setLutEntries(await api.luts.list());
    setStampEntries(await api.stamps.list());
    setApiKeyOpen(false);
  }

  async function clearApiKey(): Promise<void> {
    await api.settings.clearGeminiApiKey();
    setHasGeminiApiKey(false);
    setApiKeyDraft("");
  }

  async function requestCloseSettings(): Promise<void> {
    if (settingsDirty || apiKeyDirty) {
      const discard = await confirmer.confirm({
        title: "Discard changes?",
        message: "You have unsaved settings changes. Discard them and close?",
        confirmLabel: "Discard",
        danger: true
      });
      if (!discard) return;
    }
    setApiKeyDraft("");
    setApiKeyOpen(false);
  }

  async function toggleHistogram(): Promise<void> {
    if (!uiState) return;
    setUiState(await api.state.update({ showHistogram: !uiState.showHistogram }));
  }

  async function setHistogramPosition(position: { x: number; y: number } | null): Promise<void> {
    setUiState(await api.state.update({ histogramPosition: position }));
  }

  async function reloadLuts(): Promise<void> {
    setLutEntries(await api.luts.list());
  }

  async function reloadStamps(): Promise<void> {
    setStampEntries(await api.stamps.list());
  }

  async function updateOutput(key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value));
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    setQueue(await api.queues.snapshot());
  }

  const cancellableActiveTask = activeTask && activeTask.status === "queued";
  const hasJpegEstimate = settings?.enableJpegQualityEstimate && activeOriginal?.jpegQualityEstimate !== null;

  return (
    <main
      className={`app-shell ${globalDropActive ? "global-drop-active" : ""}`}
      onDragEnterCapture={(event) => {
        if (!hasFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        globalDragDepthRef.current += 1;
        setGlobalDropActive(true);
      }}
      onDragOverCapture={(event) => {
        if (!hasFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeaveCapture={(event) => {
        if (!hasFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
        if (globalDragDepthRef.current === 0) setGlobalDropActive(false);
      }}
      onDropCapture={(event) => {
        if (!hasFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        globalDragDepthRef.current = 0;
        setGlobalDropActive(false);
        void addDroppedFiles(event.dataTransfer.files);
      }}
    >
      {globalDropActive ? <div className="global-drop-overlay">Drop image files anywhere to import them</div> : null}
      <header className="top-bar">
        <span className="app-title">{APP_NAME}</span>
        <span className="top-bar-spacer" />
        <div className="output-badge">
          <span className="output-badge-label" title={project?.outputDir ?? ""}>Output: {outputDirLabel}</span>
          <button className="output-badge-button" type="button" onClick={() => void setOutputDir()}>
            {project?.outputDir ? "Change…" : "Choose…"}
          </button>
          {project?.outputDir ? (
            <button className="output-badge-button icon" type="button" title="Clear (save next to source)" onClick={() => void clearOutputDir()}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button className={`icon-button ${showHistogram ? "active" : ""}`} type="button" title="Toggle histogram (Cmd/Ctrl+H)" onClick={() => void toggleHistogram()}>
          <BarChart3 size={18} />
        </button>
        <button className="icon-button" type="button" title="Menu" onClick={() => setMenuOpen(!menuOpen)}>
          <Menu size={18} />
        </button>
        {menuOpen ? (
          <div className="app-menu">
            <button type="button" onClick={() => {
              setMenuOpen(false);
              void openSettings();
            }}>Settings</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setShortcutsOpen(true);
            }}>Keyboard shortcuts</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setAboutOpen(true);
            }}>About FotoReady</button>
          </div>
        ) : null}
      </header>

      <section className="workspace" style={{ gridTemplateColumns: workspaceLayout.gridTemplateColumns }}>
        {showOriginals ? (
          <OriginalsPanel
            activeOriginalId={activeOriginal?.id ?? null}
            originals={project?.originals ?? []}
            thumbnails={originalThumbnails}
            onAdd={() => void addOriginals()}
            onDropFiles={(sourcePaths) => void addOriginalPaths(sourcePaths)}
            onRemove={(originalId) => void removeOriginal(originalId)}
            onSelect={(originalId) => void selectOriginal(originalId)}
          />
        ) : null}
        {showOriginals ? <WorkspaceSplitter label="Resize Originals panel" onPointerDown={workspaceLayout.startResize("originals")} /> : null}

        {showTasks ? (
          <TasksPanel
            activeTaskId={activeTask?.id ?? null}
            originals={project?.originals ?? []}
            queue={queue}
            tasks={project?.tasks ?? []}
            onRename={() => setRenameOpen(true)}
            onSaveAll={() => void saveAll()}
            onCancelAll={() => void cancelAll()}
            onSelect={(taskId) => void selectTask(taskId)}
          />
        ) : null}
        {showTasks ? <WorkspaceSplitter label="Resize Tasks panel" onPointerDown={workspaceLayout.startResize("tasks")} /> : null}

        <section className="editor-panel">
          <div className="preview-toolbar">
            <span className="preview-detail" title={activeOriginal?.sourcePath ?? ""}>
              {activeOriginal ? basename(activeOriginal.sourcePath) : "No image"}
              {activeOriginal ? (
                <em>
                  {activeOriginal.width}×{activeOriginal.height} · {formatLabel(activeOriginal.format)}
                  {hasJpegEstimate ? ` · assumed JPEG quality ${activeOriginal.jpegQualityEstimate}` : ""}
                  {activeTask ? ` · output ${formatLabel(resolveOutputFormat(activeTask.pipeline.output.format, activeOriginal.format))}` : ""}
                  {activeTask ? ` · ${activeTask.status}` : ""}
                </em>
              ) : null}
            </span>
            {activeTask?.status === "pending" ? (
              <button className="inline-action" type="button" onClick={() => void saveTask(activeTask.id)}>
                <Save size={14} /> Save
              </button>
            ) : null}
            {cancellableActiveTask ? (
              <button className="inline-action" type="button" onClick={() => void cancelTask(activeTask!.id)}>
                <X size={14} /> Cancel
              </button>
            ) : null}
            {activeTask && activeTask.status === "done" ? (
              <button className="inline-action" type="button" onClick={() => void forkTask(activeTask.id)}>
                <CopyPlus size={14} /> Fork
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void deleteTask(activeTask)}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
            {activeTask?.output ? (
              <button className="inline-action danger" type="button" onClick={() => void deleteSavedOutput(activeTask)}>
                <Trash2 size={14} /> Delete saved file
              </button>
            ) : null}
          </div>
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
              onOpParamsChange={(opId, patch) => void updateOpParams(opId, patch)}
              originalAspectRatio={activeOriginal ? activeOriginal.width / Math.max(activeOriginal.height, 1) : null}
              preview={activePreview}
              previewState={previewState}
              previewScaleMode={previewScaleMode}
              selectedOpId={selectedOpId}
              task={activeTask}
            />
            {showHistogram ? (
              <HistogramOverlay
                preview={activePreview}
                previewState={previewState}
                onClose={() => void toggleHistogram()}
                position={uiState?.histogramPosition ?? null}
                onPositionChange={(pos) => void setHistogramPosition(pos)}
              />
            ) : null}
          </div>
          {activeTask?.error ? (
            <div className="error-strip">
              <strong>{activeTask.error.stage}</strong>
              <span>{activeTask.error.message}</span>
              {activeTask.error.retryable ? (
                <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>Retry</button>
              ) : null}
              <button className="inline-action" type="button" onClick={() => void dismissError(activeTask.id)}>Dismiss</button>
            </div>
          ) : null}
        </section>

        {showOps ? <WorkspaceSplitter label="Resize Ops panel" onPointerDown={workspaceLayout.startResize("ops")} /> : null}

        {showOps ? (
          <OpsPanel
            activeTask={activeTask}
            activeOriginal={activeOriginal}
            hasGeminiApiKey={hasGeminiApiKey}
            luts={lutEntries}
            opCatalog={opCatalog}
            pendingRevealOpId={pendingRevealOpId}
            originalSize={activeOriginal ? { width: activeOriginal.width, height: activeOriginal.height } : null}
            visionGenerating={activeTaskVisionGenerating}
            onSelectOp={selectOp}
            onAddOp={(opType) => void addOp(opType)}
            onClearVision={() => void clearVision()}
            onGenerateDescriptionChange={(value) => void setGenerateDescription(value)}
            onGenerateSlugChange={(value) => void setGenerateSlug(value)}
            onGenerateVision={(forceGenerateSlug) => void generateVision(forceGenerateSlug)}
            onCustomSlugChange={(value) => void setCustomSlug(value)}
            onOpenSettings={() => void openSettings()}
            onReloadLuts={reloadLuts}
            onReloadStamps={reloadStamps}
            onMoveOp={(opId, toIndex) => void moveOp(opId, toIndex)}
            onOpEnabledChange={(opId, enabled) => void setOpEnabled(opId, enabled)}
            onOpParamChange={(opId, key, value) => void updateOpParam(opId, key, value)}
            onOpParamsChange={(opId, patch) => void updateOpParams(opId, patch)}
            onOutputChange={(key, value) => void updateOutput(key, value)}
            onRemoveOp={(opId) => void removeOp(opId)}
            onRevealOpHandled={() => setPendingRevealOpId(null)}
            settings={settings}
            selectedOpId={selectedOpId}
            stamps={stampEntries}
          />
        ) : null}
      </section>

      {renameOpen && settings ? (
        <RenameModal
          defaultTemplateId={settings.defaultTemplateId}
          outputDirLabel={outputDirLabel}
          outputDirPath={project?.outputDir ?? null}
          onClearOutputDir={clearOutputDir}
          onClose={() => setRenameOpen(false)}
          onPreview={(templateId) => api.rename.preview(templateId)}
          onRun={async (templateId) => {
            await refreshProject(await api.rename.run(templateId));
            setRenameOpen(false);
          }}
          onSetOutputDir={setOutputDir}
          templates={settings.filenameTemplates}
        />
      ) : null}

      {apiKeyOpen ? (
        <AppSettingsModal
          apiKeyDraft={apiKeyDraft}
          onApiKeyDraftChange={setApiKeyDraft}
          onClearApiKey={() => void clearApiKey()}
          hasChanges={settingsDirty || apiKeyDirty}
          hasGeminiApiKey={hasGeminiApiKey}
          onClose={() => void requestCloseSettings()}
          onSaveSettings={() => void saveSettingsDraft()}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          systemInfo={systemInfo}
        />
      ) : null}

      {shortcutsOpen ? (
        <ModalShell title="Keyboard shortcuts" size="small" onClose={() => setShortcutsOpen(false)}>
          <div className="shortcut-list">
            {SHORTCUT_SECTIONS.map(({ title, items }) => (
              <section className="shortcut-group" key={title}>
                <h3>{title}</h3>
                {items.map(({ action, detail, keys }) => (
                  <div className="shortcut-row" key={action}>
                    <div className="shortcut-row-copy">
                      <span>{action}</span>
                      {detail ? <small>{detail}</small> : null}
                    </div>
                    <kbd>{keys}</kbd>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {aboutOpen ? (
        <ModalShell title="About FotoReady" size="small" onClose={() => setAboutOpen(false)}>
          <div className="about-dialog">
            <div>
              <h3>FotoReady</h3>
              <p className="about-version">Version {systemInfo?.version ?? "0.1.0"}</p>
            </div>
            <p>
              A desktop photo editor for blogging and publication workflows, with queued image processing,
              metadata controls, rename previews, and optional Gemini-assisted descriptions and slugs.
            </p>
            <div className="about-links">
              <button className="toolbar-button" type="button" onClick={() => void api.system.openExternal(APP_REPOSITORY_URL)}>
                GitHub
              </button>
              <button className="toolbar-button" type="button" onClick={() => void api.system.openExternal(APP_ISSUES_URL)}>
                Issues
              </button>
            </div>
            <div className="settings-summary">
              <span>Developer</span>
              <code>Yoshinao Inoguchi</code>
            </div>
            <div className="settings-summary">
              <span>License</span>
              <code>MIT</code>
            </div>
          </div>
        </ModalShell>
      ) : null}

      <footer className="status-bar">
        <span className="queue-summary">{summarizeQueue(queue)}</span>
        <span className="top-bar-spacer" />
      </footer>
    </main>
  );
}

function WorkspaceSplitter({
  label,
  onPointerDown
}: {
  label: string;
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void;
}): React.JSX.Element {
  return <button aria-label={label} className="workspace-splitter" type="button" onPointerDown={onPointerDown} />;
}

/** Build a short, sparse summary for the status bar. Hides zero-count categories. */
function summarizeQueue(queue: QueueSnapshot): string {
  const parts = [`${queue.done}/${queue.total}`];
  if (queue.processing > 0) parts.push(`${queue.processing} running`);
  if (queue.queued > 0) parts.push(`${queue.queued} queued`);
  if (queue.errors > 0) parts.push(`${queue.errors} failed`);
  if (queue.activeTaskLabel && queue.processing > 0) parts.push(queue.activeTaskLabel);
  return parts.join(" · ");
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}

function taskLabel(task: Task, originals: { id: string; sourcePath: string }[]): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

function stringifyLogArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? arg.message;
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(" ");
}

createRoot(document.getElementById("root")!).render(
  <ConfirmerProvider>
    <App />
  </ConfirmerProvider>
);
