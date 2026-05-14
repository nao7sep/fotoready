import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, CopyPlus, Menu, RotateCcw, Save, Trash2, X } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import type { LutEntry, OpCatalogItem, PreviewResult, ProjectSnapshot, QueueSnapshot, SystemInfo, TaskDeleteOptions } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import { APP_NAME } from "@shared/constants";
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

const SHORTCUTS: ReadonlyArray<{ action: string; keys: string }> = [
  { action: "Save current task", keys: "Cmd/Ctrl+S" },
  { action: "Save all pending tasks", keys: "Cmd/Ctrl+Shift+S" },
  { action: "Undo current task edits", keys: "Cmd/Ctrl+Z" },
  { action: "Rename saved outputs", keys: "Cmd/Ctrl+R" },
  { action: "Toggle histogram", keys: "Cmd/Ctrl+H" },
  { action: "Show or hide Originals", keys: "Cmd/Ctrl+1" },
  { action: "Show or hide Tasks", keys: "Cmd/Ctrl+2" },
  { action: "Show or hide Ops", keys: "Cmd/Ctrl+3" },
  { action: "Open Settings", keys: "Cmd/Ctrl+," }
];

function App(): React.JSX.Element {
  const confirmer = useConfirmer();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [uiState, setUiState] = useState<UiState | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [lutEntries, setLutEntries] = useState<LutEntry[]>([]);
  const [preview, setPreview] = useState<{ taskId: string; dataUrl: string; width: number; height: number } | null>(null);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [renameOpen, setRenameOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOriginals, setShowOriginals] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [selectedRenameTaskIds, setSelectedRenameTaskIds] = useState<string[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [queue, setQueue] = useState<QueueSnapshot>(initialQueueSnapshot);
  const [selectedOpIndex, setSelectedOpIndex] = useState<number | null>(null);
  const opPreviewCacheRef = useRef<Map<string, PreviewResult>>(new Map());
  const workspaceLayout = useWorkspaceLayout({ showOps, showOriginals, showTasks });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;
  const erroredTasks = project?.tasks.filter((task) => task.error) ?? [];
  const showHistogram = uiState?.showHistogram ?? false;
  const outputDirLabel = !project?.outputDir ? "Same as original" : project.outputDir;
  const settingsDirty = Boolean(settingsDraft && settings && JSON.stringify(settingsDraft) !== JSON.stringify(settings));
  const apiKeyDirty = apiKeyDraft.trim().length > 0;
  const previewRequest = useMemo(() => {
    if (!activeTask) return null;
    const selectedOp = selectedOpIndex !== null ? activeTask.pipeline.ops[selectedOpIndex] : null;
    // Cards with previewBehavior "show-input" (crop, redact, watermark, white-balance) display
    // the image *before* their own op so the overlay rectangle lines up with the unaltered base.
    // Other cards include themselves so slider edits appear live.
    const selectedDefinition = selectedOp ? opCatalog.find((item) => item.type === selectedOp.type) : null;
    const truncateOpsAt =
      selectedOpIndex !== null
        ? selectedDefinition?.previewBehavior === "show-input"
          ? selectedOpIndex
          : selectedOpIndex + 1
        : null;
    const previewOps =
      truncateOpsAt !== null ? activeTask.pipeline.ops.slice(0, truncateOpsAt) : activeTask.pipeline.ops;
    const cacheKey = JSON.stringify({
      taskId: activeTask.id,
      originalId: activeTask.originalId,
      ops: previewOps,
      output: activeTask.pipeline.output
    });
    return { taskId: activeTask.id, truncateOpsAt, cacheKey };
  }, [activeTask, opCatalog, selectedOpIndex]);

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.state.get(), api.settings.hasGeminiApiKey(), api.project.current(), api.ops.list(), api.queues.snapshot(), api.luts.list()]).then(
      ([info, loadedSettings, loadedState, geminiKeyConfigured, loadedProject, loadedOps, snapshot, loadedLuts]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setUiState(loadedState);
        setHasGeminiApiKey(geminiKeyConfigured);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
        setLutEntries(loadedLuts);
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
      if (mod && event.key === "1") {
        event.preventDefault();
        setShowOriginals((value) => !value);
      } else if (mod && event.key === "2") {
        event.preventDefault();
        setShowTasks((value) => !value);
      } else if (mod && event.key === "3") {
        event.preventDefault();
        setShowOps((value) => !value);
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
    setSelectedOpIndex(null);
  }, [activeTask?.id]);

  useEffect(() => {
    setSelectedOpIndex((current) => {
      if (current === null) return current;
      const opCount = activeTask?.pipeline.ops.length ?? 0;
      return current < opCount ? current : null;
    });
  }, [activeTask?.pipeline.ops.length]);

  useEffect(() => {
    opPreviewCacheRef.current.clear();
  }, [activeTask?.id]);

  useEffect(() => {
    if (!previewRequest) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }

    const cached = opPreviewCacheRef.current.get(previewRequest.cacheKey);
    if (cached) {
      setPreview(cached);
      setPreviewState("idle");
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    setPreview(null);
    setPreviewState("loading");
    timeoutId = window.setTimeout(() => {
      const renderOptions = previewRequest.truncateOpsAt !== null ? { truncateOpsAt: previewRequest.truncateOpsAt } : undefined;
      void api.preview.render(previewRequest.taskId, renderOptions)
        .then((result) => {
          if (!cancelled) {
            opPreviewCacheRef.current.set(previewRequest.cacheKey, result);
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
  }, [previewRequest, settings?.previewDebounceMs]);

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
    if (settings?.confirmDeleteOriginalWithTasks && taskCount > 0) {
      const confirmed = await confirmer.confirm({
        title: "Remove original?",
        message: `This will also remove ${taskCount} task${taskCount === 1 ? "" : "s"}. The source file on disk is not deleted.`,
        confirmLabel: "Remove",
        danger: true
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
      const deleteOptions = await resolveTaskDeleteOptions(task, settings, confirmer);
      await refreshProject(await api.task.delete(task.id, deleteOptions));
      setSelectedRenameTaskIds((current) => current.filter((id) => id !== task.id));
    } catch (error) {
      console.error(error);
      await confirmer.alert({
        title: "Couldn't delete task",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function retryTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.retry(taskId));
  }

  async function dismissError(taskId: string): Promise<void> {
    await refreshProject(await api.task.dismissError(taskId));
  }

  async function revealSource(): Promise<void> {
    if (activeOriginal) await api.system.revealInFolder(activeOriginal.sourcePath);
  }

  async function revealTaskSource(task: Task): Promise<void> {
    const original = project?.originals.find((item) => item.id === task.originalId);
    if (original) await api.system.revealInFolder(original.sourcePath);
  }

  async function editErroredTask(task: Task): Promise<void> {
    if (task.error) await refreshProject(await api.task.dismissError(task.id));
    await refreshProject(await api.task.select(task.id));
    setErrorsOpen(false);
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
    const updatedTask = snapshot.project.tasks.find((task) => task.id === snapshot.activeTaskId);
    setSelectedOpIndex(updatedTask && updatedTask.pipeline.ops.length > 0 ? updatedTask.pipeline.ops.length - 1 : null);
  }

  async function removeOp(opIndex: number): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.removeOp(activeTask.id, opIndex));
  }

  async function setOpEnabled(opIndex: number, enabled: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setOpEnabled(activeTask.id, opIndex, enabled));
  }

  async function updateOpParam(opIndex: number, key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParam(activeTask.id, opIndex, key, value));
  }

  async function updateOpParams(opIndex: number, patch: Record<string, unknown>): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParams(activeTask.id, opIndex, patch));
  }

  async function setAnalyzeContent(analyzeContent: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setAnalyzeContent(activeTask.id, analyzeContent));
  }

  async function setCustomSlug(customSlug: string | null): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setCustomSlug(activeTask.id, customSlug));
  }

  async function runVision(taskId: string): Promise<void> {
    if (!hasGeminiApiKey) {
      await openSettings();
      return;
    }
    await refreshProject(await api.vision.runForTask(taskId));
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
    setApiKeyOpen(false);
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

  async function updateOutput(key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value));
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    const doneTaskIds = new Set(snapshot.project.tasks.filter((task) => task.status === "done").map((task) => task.id));
    setSelectedRenameTaskIds((current) => current.filter((taskId) => doneTaskIds.has(taskId)));
    setQueue(await api.queues.snapshot());
  }

  function toggleRenameSelection(taskId: string, selected: boolean): void {
    setSelectedRenameTaskIds((current) => {
      if (selected) return current.includes(taskId) ? current : [...current, taskId];
      return current.filter((id) => id !== taskId);
    });
  }

  const cancellableActiveTask = activeTask && activeTask.status === "queued";

  return (
    <main className="app-shell">
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
        <button className="icon-button" type="button" title="Menu" onClick={() => setMenuOpen((value) => !value)}>
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
            selectedRenameTaskIds={selectedRenameTaskIds}
            tasks={project?.tasks ?? []}
            onRename={() => setRenameOpen(true)}
            onSaveAll={() => void saveAll()}
            onCancelAll={() => void cancelAll()}
            onSelect={(taskId) => void selectTask(taskId)}
            onToggleRenameSelection={toggleRenameSelection}
          />
        ) : null}
        {showTasks ? <WorkspaceSplitter label="Resize Tasks panel" onPointerDown={workspaceLayout.startResize("tasks")} /> : null}

        <section className="editor-panel">
          <div className="preview-toolbar">
            <span className="preview-detail" title={activeOriginal?.sourcePath ?? ""}>
              {activeOriginal ? basename(activeOriginal.sourcePath) : "No image"}
              {activeOriginal ? (
                <em>
                  {activeOriginal.width}×{activeOriginal.height}
                  {activePreview ? ` · preview ${activePreview.width}×${activePreview.height}` : ""}
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
            {activeTask?.error ? (
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>
                <RotateCcw size={14} /> Retry
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void deleteTask(activeTask)}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
          </div>
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
              onOpParamsChange={(opIndex, patch) => void updateOpParams(opIndex, patch)}
              originalAspectRatio={activeOriginal ? activeOriginal.width / Math.max(activeOriginal.height, 1) : null}
              preview={activePreview}
              previewState={previewState}
              selectedOpIndex={selectedOpIndex}
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
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>Retry</button>
              <button className="inline-action" disabled={!activeOriginal} type="button" onClick={() => void revealSource()}>Reveal source</button>
              <button className="inline-action" type="button" onClick={() => void dismissError(activeTask.id)}>Dismiss</button>
            </div>
          ) : null}
        </section>

        {showOps ? <WorkspaceSplitter label="Resize Ops panel" onPointerDown={workspaceLayout.startResize("ops")} /> : null}

        {showOps ? (
          <OpsPanel
            activeTask={activeTask}
            hasGeminiApiKey={hasGeminiApiKey}
            luts={lutEntries}
            opCatalog={opCatalog}
            originalSize={activeOriginal ? { width: activeOriginal.width, height: activeOriginal.height } : null}
            onSelectOp={setSelectedOpIndex}
            onAddOp={(opType) => void addOp(opType)}
            onAnalyzeContentChange={(value) => void setAnalyzeContent(value)}
            onCustomSlugChange={(value) => void setCustomSlug(value)}
            onOpenSettings={() => void openSettings()}
            onOpEnabledChange={(index, enabled) => void setOpEnabled(index, enabled)}
            onOpParamChange={(index, key, value) => void updateOpParam(index, key, value)}
            onOpParamsChange={(index, patch) => void updateOpParams(index, patch)}
            onOutputChange={(key, value) => void updateOutput(key, value)}
            onRemoveOp={(index) => void removeOp(index)}
            settings={settings}
            selectedOpIndex={selectedOpIndex}
          />
        ) : null}
      </section>

      {renameOpen && settings ? (
        <RenameModal
          defaultTemplateId={settings.defaultTemplateId}
          doneTasks={(project?.tasks ?? []).filter((task) => task.status === "done").map((task) => ({
            id: task.id,
            label: taskLabel(task, project?.originals ?? []),
            selected: selectedRenameTaskIds.includes(task.id)
          }))}
          hasGeminiApiKey={hasGeminiApiKey}
          onClose={() => setRenameOpen(false)}
          onGenerateMissing={async (taskIds, onProgress) => {
            const failures: string[] = [];
            for (const [index, taskId] of taskIds.entries()) {
              const snapshot = await api.vision.runForTask(taskId);
              await refreshProject(snapshot);
              const task = snapshot.project.tasks.find((candidate) => candidate.id === taskId);
              if (task?.error?.stage === "vision") {
                failures.push(`${taskLabel(task, snapshot.project.originals)}: ${task.error.message}`);
              }
              onProgress(index + 1, taskIds.length);
            }
            if (failures.length > 0) {
              throw new Error(failures.join(" "));
            }
          }}
          onOpenSettings={() => {
            setRenameOpen(false);
            void openSettings();
          }}
          onPreview={(templateId, taskIds) => api.rename.preview(templateId, taskIds)}
          onRun={async (templateId, taskIds) => {
            await refreshProject(await api.rename.run(templateId, taskIds));
            setRenameOpen(false);
          }}
          onTaskSelected={toggleRenameSelection}
          selectedTaskIds={selectedRenameTaskIds}
          templates={settings.filenameTemplates}
        />
      ) : null}

      {apiKeyOpen ? (
        <AppSettingsModal
          apiKeyDraft={apiKeyDraft}
          onApiKeyDraftChange={setApiKeyDraft}
          hasChanges={settingsDirty || apiKeyDirty}
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
            {SHORTCUTS.map(({ action, keys }) => (
              <div className="shortcut-row" key={action}>
                <span>{action}</span>
                <kbd>{keys}</kbd>
              </div>
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
              metadata tools, rename previews, and optional Gemini-assisted descriptions.
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
              <span>Data directory</span>
              <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
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
        {erroredTasks.length ? (
          <button className="toolbar-button compact-text" type="button" onClick={() => setErrorsOpen(true)}>
            Errors
          </button>
        ) : null}
      </footer>

      {errorsOpen ? (
        <ModalShell title="Errors" onClose={() => setErrorsOpen(false)}>
          <div className="error-center-list">
            {erroredTasks.length ? erroredTasks.map((task) => (
              <div className="error-center-row" key={task.id}>
                <div>
                  <strong>{taskLabel(task, project?.originals ?? [])}</strong>
                  <span>{task.error?.stage}: {task.error?.message}</span>
                </div>
                <button className="toolbar-button" type="button" onClick={() => void retryTask(task.id)}>Retry</button>
                <button className="toolbar-button" type="button" onClick={() => void editErroredTask(task)}>Edit task</button>
                <button className="toolbar-button" type="button" onClick={() => void revealTaskSource(task)}>Reveal source</button>
                <button className="toolbar-button" type="button" onClick={() => void dismissError(task.id)}>Dismiss</button>
              </div>
            )) : <div className="ops-empty">No current task errors</div>}
          </div>
        </ModalShell>
      ) : null}
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

async function resolveTaskDeleteOptions(
  task: Task,
  settings: GlobalSettings | null,
  confirmer: { confirm(req: { title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean> }
): Promise<TaskDeleteOptions | undefined> {
  if (task.status !== "done" || !task.output) {
    return undefined;
  }

  const hasSeparateFinalOutput = Boolean(task.output.finalPath && task.output.finalPath !== task.output.stagedPath);
  if (!settings?.confirmDeleteOutputFiles) {
    return hasSeparateFinalOutput
      ? { deleteFinalOutput: true }
      : task.output.stagedPath
        ? { deleteStagedOutput: true }
        : undefined;
  }

  if (hasSeparateFinalOutput && task.output.finalPath) {
    const finalPath = task.output.finalPath;
    return {
      deleteFinalOutput: await confirmer.confirm({
        title: "Delete renamed output?",
        message: finalPath,
        confirmLabel: "Delete",
        danger: true
      })
    };
  }

  if (task.output.stagedPath) {
    const shouldDeleteOutput = await confirmer.confirm({
      title: "Delete output file?",
      message: task.output.stagedPath,
      confirmLabel: "Delete",
      danger: true
    });
    return {
      deleteStagedOutput: shouldDeleteOutput,
      deleteFinalOutput: task.output.finalPath === task.output.stagedPath ? shouldDeleteOutput : false
    };
  }

  return undefined;
}

createRoot(document.getElementById("root")!).render(
  <ConfirmerProvider>
    <App />
  </ConfirmerProvider>
);
