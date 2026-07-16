import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, BarChart3, CopyPlus, KeyRound, Menu as MenuIcon, Save, Trash2, X } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import type { LutEntry, OpCatalogItem, PreviewRenderMode, PreviewResult, PrivacyWarning, ProjectSnapshot, QueueSnapshot, StampEntry, SystemInfo, TaskEditOptions, VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
import type { Project, Task } from "@shared/types/project";
import { APP_NAME } from "@shared/constants";
import { formatLabel, resolveOutputFormat } from "@shared/output-format";
import { pipelineForPreview } from "@shared/preview-pipeline";
import { resolveSlugRegenerationMode } from "@shared/vision-run-mode";
import { EditorCanvas } from "./components/canvas/editor-canvas";
import { HistogramOverlay } from "./components/canvas/histogram-overlay";
import { RenameModal, type RenameRunSummary } from "./components/modals/rename-modal";
import { AppSettingsModal, type SettingsTab } from "./components/modals/settings-modal";
import { AboutModal } from "./components/modals/about-modal";
import { ShortcutsModal } from "./components/modals/shortcuts-modal";
import { Menu, MenuItem } from "./components/Menu";
import { ErrorBoundary } from "./components/error-boundary";
import { isModalOpen } from "./components/modals/modal-stack";
import { ConfirmerProvider, useConfirmer } from "./components/modals/confirmer";
import { OpsPanel } from "./components/panels/ops-panel";
import { OriginalsPanel } from "./components/panels/originals-panel";
import { TasksPanel } from "./components/panels/tasks-panel";
import { useWorkspaceLayout, type WorkspaceWidths } from "./layout/workspace-layout";
import { PANE_DEFAULTS } from "@shared/layout/workspace-metrics";
import type { ImageFitMode } from "./ops/_overlay-primitives";
import { useEditorStore } from "./state/editor-store";
import { taskStateLabel } from "./task-visual-state";
import { isTextEditingShortcutTarget } from "./utils/editing-target";
import { isComposingKeyboardEvent } from "./utils/ime-guard";
import "./styles/app.css";

const initialQueueSnapshot: QueueSnapshot = {
  saved: 0,
  total: 0,
  notSaved: 0,
  queued: 0,
  processing: 0,
  errors: 0,
  activeTaskId: null,
  activeTaskLabel: null
};

function App(): React.JSX.Element {
  const confirmer = useConfirmer();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  // Live UI shows the running platform's single modifier word, never the combined
  // "Cmd/Ctrl" (keyboard-shortcut-conventions) — same resolution the shortcuts modal uses.
  const mod = systemInfo && systemInfo.platform !== "darwin" ? "Ctrl" : "Cmd";
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [uiState, setUiState] = useState<UiState | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [lutEntries, setLutEntries] = useState<LutEntry[]>([]);
  const [stampEntries, setStampEntries] = useState<StampEntry[]>([]);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyClearRequested, setApiKeyClearRequested] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("save");
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [globalDropActive, setGlobalDropActive] = useState(false);
  const [queue, setQueue] = useState<QueueSnapshot>(initialQueueSnapshot);
  const [pendingRevealOpId, setPendingRevealOpId] = useState<string | null>(null);
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
  const settingsOpen = useEditorStore((state) => state.settingsOpen);
  const setSettingsOpen = useEditorStore((state) => state.setSettingsOpen);
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
  const currentOriginalIdsRef = useRef(new Set<string>());
  const originalThumbnailIdsRef = useRef(new Set<string>());
  const originalThumbnailRequestsRef = useRef(new Set<string>());
  // Pane widths live in state.json (via the state IPC), not localStorage, so the main process can size
  // the window from them. Until state.json loads, fall back to the shipped defaults — same async
  // pattern as showHistogram below. A drag persists the new intent; a window resize persists nothing.
  const persistWorkspaceWidths = useCallback((workspaceWidths: WorkspaceWidths): void => {
    void api.state.update({ workspaceWidths }).then(setUiState);
  }, []);
  const workspaceLayout = useWorkspaceLayout({
    showOps,
    showOriginals,
    showTasks,
    widths: uiState?.workspaceWidths ?? PANE_DEFAULTS,
    onWidthsChange: persistWorkspaceWidths
  });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;
  const showHistogram = uiState?.showHistogram ?? false;
  const outputDirLabel = !project?.outputDir ? "Same as original" : project.outputDir;
  const settingsDirty = Boolean(settingsDraft && settings && JSON.stringify(settingsDraft) !== JSON.stringify(settings));
  const apiKeyDirty = apiKeyDraft.trim().length > 0 || apiKeyClearRequested;
  const activeTaskVisionMode = activeTask?.visionRunMode ?? null;
  const activeTaskVisionGenerating = Boolean(activeTask?.visionRunning);
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

  // Apply the configured UI font by overriding the `--font-ui` CSS variable on :root; blank reverts
  // to the app.css default. The string is handed to CSS verbatim (engine-resolved, graceful fallback)
  // per the app-chrome-conventions. The watermark font is unaffected — it is content-output.
  useEffect(() => {
    const family = settings?.uiFontFamily?.trim();
    const root = document.documentElement;
    if (family) root.style.setProperty("--font-ui", family);
    else root.style.removeProperty("--font-ui");
  }, [settings?.uiFontFamily]);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      void api.system.log({ level: "warn", message: stringifyLogArgs(args), fields: { mod: "renderer.console" } });
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      void api.system.log({ level: "error", message: stringifyLogArgs(args), fields: { mod: "renderer.console" } });
    };
    const onError = (event: ErrorEvent) =>
      void api.system.log({
        level: "error",
        message: event.message,
        fields: { mod: "renderer.onerror", stack: event.error instanceof Error ? event.error.stack ?? null : null }
      });
    const onRejection = (event: PromiseRejectionEvent) =>
      void api.system.log({
        level: "error",
        message: "Unhandled renderer rejection",
        fields: { mod: "renderer.unhandledrejection", reason: stringifyLogArgs([event.reason]) }
      });
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
      // While any modal/dialog is open it owns the keyboard: global shortcuts must not reach the
      // window behind it (Escape and modal-local keys are handled inside the modal layer itself).
      if (isModalOpen()) return;
      // A chord pressed while an IME candidate is pending belongs to the composition; stand down
      // until it commits, rather than firing on a not-yet-committed candidate (text-input-ime).
      if (isComposingKeyboardEvent(event)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void addOriginals();
      } else if (mod && event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAll();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTask?.status === "not-saved") void saveTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (isTextEditingShortcutTarget(event.target)) return;
        event.preventDefault();
        if (activeTask?.status === "not-saved") void undoTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (project?.tasks.some((task) => task.status === "saved")) setRenameOpen(true);
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
    return api.lifecycle.onCloseRequest(() => {
      void (async () => {
        if (settingsDirty || apiKeyDirty) {
          const discard = await confirmer.confirm({
            title: "Discard changes?",
            message: "You have unsaved settings changes. Discard them and close?",
            confirmLabel: "Discard",
            danger: true
          });
          if (!discard) {
            await api.lifecycle.approveClose(false);
            return;
          }
        }

        if (hasWorkspaceWork(project, queue)) {
          const close = await confirmer.confirm({
            title: "Close FotoReady?",
            message: "Close and discard the current workspace?",
            confirmLabel: "Close",
            danger: true
          });
          await api.lifecycle.approveClose(close);
          return;
        }

        await api.lifecycle.approveClose(true);
      })();
    });
  }, [apiKeyDirty, confirmer, project, queue, settingsDirty]);

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
    const originalIds = new Set(originals.map((original) => original.id));
    currentOriginalIdsRef.current = originalIds;
    originalThumbnailIdsRef.current.forEach((id) => {
      if (!originalIds.has(id)) originalThumbnailIdsRef.current.delete(id);
    });
    originalThumbnailRequestsRef.current.forEach((id) => {
      if (!originalIds.has(id)) originalThumbnailRequestsRef.current.delete(id);
    });
    setOriginalThumbnails((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => originalIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });

    const missing = originals.filter((original) =>
      !originalThumbnailIdsRef.current.has(original.id) && !originalThumbnailRequestsRef.current.has(original.id)
    );
    if (missing.length === 0) return;

    for (const original of missing) {
      originalThumbnailRequestsRef.current.add(original.id);
      void api.preview.originalThumbnail(original.id)
        .then((thumbnail) => {
          originalThumbnailRequestsRef.current.delete(thumbnail.originalId);
          if (!currentOriginalIdsRef.current.has(thumbnail.originalId)) return;
          originalThumbnailIdsRef.current.add(thumbnail.originalId);
          setOriginalThumbnails((current) => ({ ...current, [thumbnail.originalId]: thumbnail.dataUrl }));
        })
        .catch((thumbnailError) => {
          console.warn("Failed to load original thumbnail", original.id, thumbnailError);
          originalThumbnailRequestsRef.current.delete(original.id);
          if (!currentOriginalIdsRef.current.has(original.id)) return;
          originalThumbnailIdsRef.current.add(original.id);
          setOriginalThumbnails((current) => ({ ...current, [original.id]: "" }));
        });
    }
  }, [project?.originals]);

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
    originalThumbnailIdsRef.current.delete(originalId);
    originalThumbnailRequestsRef.current.delete(originalId);
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
      const deletePaths = savedOutputDeletePaths(task);
      const confirmed = await confirmer.confirm({
        title: "Move saved files to the trash?",
        message: `These files will be moved to the system trash and can be restored from there:\n\n${deletePaths.join("\n")}`,
        confirmLabel: "Move to trash",
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

  async function updateOpParam(opId: string, key: string, value: unknown, options?: TaskEditOptions): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParam(activeTask.id, opId, key, value, options));
  }

  async function updateOpParams(opId: string, patch: Record<string, unknown>, options?: TaskEditOptions): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParams(activeTask.id, opId, patch, options));
  }

  async function setGenerateDescription(generateDescription: boolean): Promise<void> {
    const task = activeTask;
    if (!task) return;
    await refreshProject(await api.task.setGenerateDescription(task.id, generateDescription));
  }

  async function setGenerateSlug(generateSlug: boolean): Promise<void> {
    const task = activeTask;
    if (!task) return;
    await refreshProject(await api.task.setGenerateSlug(task.id, generateSlug));
  }

  async function setCustomSlug(customSlug: string | null): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setCustomSlug(activeTask.id, customSlug));
  }

  async function generateVision(mode: VisionRunMode): Promise<void> {
    if (!activeTask?.output) return;
    await runVisionForTask(activeTask.id, { mode });
  }

  async function clearVision(): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.clearVision(activeTask.id));
  }

  async function runVisionForTask(taskId: string, options?: VisionRunOptions): Promise<void> {
    await refreshProject(await api.vision.runForTask(taskId, options));
  }

  async function addDroppedFiles(files: FileList | File[]): Promise<void> {
    const sourcePaths = Array.from(files)
      .map((file) => window.api.system.filePathForFile(file))
      .filter((filePath) => filePath.length > 0);
    if (sourcePaths.length === 0) return;
    await addOriginalPaths(sourcePaths);
  }

  function openSettings(initialTab: SettingsTab = "save"): void {
    setSettingsInitialTab(initialTab);
    setSettingsDraft(settings);
    setApiKeyClearRequested(false);
    setSettingsOpen(true);
  }

  async function saveSettingsDraft(): Promise<void> {
    if (!settingsDraft) return;
    if (apiKeyClearRequested) {
      await api.settings.clearGeminiApiKey();
      setHasGeminiApiKey(false);
      setApiKeyClearRequested(false);
    } else if (apiKeyDraft.trim()) {
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
    setSettingsOpen(false);
  }

  function updateApiKeyDraft(value: string): void {
    setApiKeyDraft(value);
    if (value.trim()) setApiKeyClearRequested(false);
  }

  function requestClearApiKey(): void {
    setApiKeyDraft("");
    setApiKeyClearRequested(true);
  }

  function keepSavedApiKey(): void {
    setApiKeyClearRequested(false);
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
    setApiKeyClearRequested(false);
    setSettingsOpen(false);
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

  async function updateOutput(key: string, value: unknown, options?: TaskEditOptions): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value, options));
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
            {project?.outputDir ? "Change" : "Choose"}
          </button>
          {project?.outputDir ? (
            <button className="output-badge-button icon" type="button" title="Clear (save next to source)" onClick={() => void clearOutputDir()}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button className={`icon-button ${showHistogram ? "active" : ""}`} type="button" title={`Toggle histogram (${mod}+H)`} onClick={() => void toggleHistogram()}>
          <BarChart3 size={18} />
        </button>
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label="Main menu"
          className="app-menu"
          trigger={({ ref, ...props }) => (
            <button {...props} ref={ref} className="icon-button" title="Menu">
              <MenuIcon size={18} />
            </button>
          )}
        >
          <MenuItem onSelect={() => openSettings()}>Settings</MenuItem>
          <MenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard shortcuts</MenuItem>
          <MenuItem onSelect={() => setAboutOpen(true)}>About FotoReady</MenuItem>
        </Menu>
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
            privacyWarnings={projectSnapshot?.privacyWarnings ?? {}}
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
                  {activeTask ? ` · ${taskStateLabel(activeTask, queue)}` : ""}
                </em>
              ) : null}
            </span>
            {activeTask?.status === "not-saved" ? (
              <button className="inline-action" type="button" onClick={() => void saveTask(activeTask.id)}>
                <Save size={14} /> Save
              </button>
            ) : null}
            {cancellableActiveTask ? (
              <button className="inline-action" type="button" onClick={() => void cancelTask(activeTask!.id)}>
                <X size={14} /> Cancel
              </button>
            ) : null}
            {activeTask && activeTask.status === "saved" ? (
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
              onOpParamsChange={(opId, patch, options) => void updateOpParams(opId, patch, options)}
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
              <strong>{errorStageLabel(activeTask.error.stage)}</strong>
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
            addOpsWidth={workspaceLayout.addOpsWidth}
            activeTask={activeTask}
            activeOriginal={activeOriginal}
            hasGeminiApiKey={hasGeminiApiKey}
            luts={lutEntries}
            opCatalog={opCatalog}
            pendingRevealOpId={pendingRevealOpId}
            originalSize={activeOriginal ? { width: activeOriginal.width, height: activeOriginal.height } : null}
            visionGenerating={activeTaskVisionGenerating}
            visionGenerationMode={activeTaskVisionMode}
            onSelectOp={selectOp}
            onAddOp={(opType) => void addOp(opType)}
            onClearVision={() => void clearVision()}
            onGenerateDescriptionChange={(value) => void setGenerateDescription(value)}
            onGenerateSlugChange={(value) => void setGenerateSlug(value)}
            onGenerateVision={(mode) => void generateVision(mode)}
            onCustomSlugChange={(value) => void setCustomSlug(value)}
            onOpenSettings={() => void openSettings("vision")}
            onReloadLuts={reloadLuts}
            onReloadStamps={reloadStamps}
            onMoveOp={(opId, toIndex) => void moveOp(opId, toIndex)}
            onOpEnabledChange={(opId, enabled) => void setOpEnabled(opId, enabled)}
            onOpParamChange={(opId, key, value, options) => void updateOpParam(opId, key, value, options)}
            onOpParamsChange={(opId, patch, options) => void updateOpParams(opId, patch, options)}
            onOutputChange={(key, value, options) => void updateOutput(key, value, options)}
            onRemoveOp={(opId) => void removeOp(opId)}
            onRevealOpHandled={() => setPendingRevealOpId(null)}
            settings={settings}
            selectedOpId={selectedOpId}
            stamps={stampEntries}
          />
        ) : null}
      </section>

      {renameOpen && project ? (
        <RenameModal
          projectSnapshot={projectSnapshot}
          outputDirLabel={outputDirLabel}
          outputDirPath={project?.outputDir ?? null}
          onClearOutputDir={clearOutputDir}
          onClose={() => setRenameOpen(false)}
          onPreview={(templateId) => api.rename.preview(templateId)}
          onRegenerateSlug={async (taskId) => {
            const task = project?.tasks.find((candidate) => candidate.id === taskId);
            if (!task?.output) return;
            const mode = resolveSlugRegenerationMode(task.output.vision?.description);
            await runVisionForTask(taskId, { mode });
          }}
          onRun={async (templateId, summary) => {
            await refreshProject(await api.rename.run(templateId));
            setRenameOpen(false);
            await confirmer.alert({
              title: "Rename complete",
              message: <RenameCompleteMessage summary={summary} />
            });
          }}
          onSetRenameSlug={async (taskId, customSlug) => {
            await refreshProject(await api.task.setCustomSlug(taskId, customSlug));
          }}
          onSetOutputDir={setOutputDir}
        />
      ) : null}

      {settingsOpen ? (
        <AppSettingsModal
          apiKeyDraft={apiKeyDraft}
          apiKeyClearRequested={apiKeyClearRequested}
          onApiKeyDraftChange={updateApiKeyDraft}
          onClearApiKey={requestClearApiKey}
          onKeepApiKey={keepSavedApiKey}
          hasChanges={settingsDirty || apiKeyDirty}
          hasGeminiApiKey={hasGeminiApiKey}
          initialTab={settingsInitialTab}
          onClose={() => void requestCloseSettings()}
          onSaveSettings={() => void saveSettingsDraft()}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          systemInfo={systemInfo}
        />
      ) : null}

      {shortcutsOpen ? <ShortcutsModal systemInfo={systemInfo} onClose={() => setShortcutsOpen(false)} /> : null}

      {aboutOpen ? <AboutModal systemInfo={systemInfo} onClose={() => setAboutOpen(false)} /> : null}

      <footer className="status-bar">
        <StatusBar
          queue={queue}
          privacyWarnings={projectSnapshot?.privacyWarnings ?? null}
          hasGeminiApiKey={systemInfo ? hasGeminiApiKey : null}
          onOpenSettings={() => void openSettings("vision")}
        />
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

function StatusBar({
  queue,
  privacyWarnings,
  hasGeminiApiKey,
  onOpenSettings
}: {
  queue: QueueSnapshot;
  privacyWarnings: Record<string, PrivacyWarning> | null;
  hasGeminiApiKey: boolean | null;
  onOpenSettings(): void;
}): React.JSX.Element {
  const privacyCount = privacyWarnings ? Object.keys(privacyWarnings).length : 0;
  const idle = queue.processing === 0 && queue.queued === 0 && queue.errors === 0;
  return (
    <>
      <div className="status-zone status-zone-left">
        {queue.total === 0 ? (
          <span className="status-chip status-chip-muted">No tasks</span>
        ) : (
          <>
            <span className="status-chip status-chip-muted">{queue.total} {queue.total === 1 ? "task" : "tasks"}</span>
            <span className="status-chip status-chip-muted">{queue.saved}/{queue.total} saved</span>
          </>
        )}
        {queue.processing > 0 ? <span className="status-chip status-chip-active">{queue.processing} running</span> : null}
        {queue.queued > 0 ? <span className="status-chip status-chip-info">{queue.queued} queued</span> : null}
        {queue.errors > 0 ? <span className="status-chip status-chip-danger">{queue.errors} failed</span> : null}
        {queue.activeTaskLabel ? <span className="status-active-label" title={queue.activeTaskLabel}>{queue.activeTaskLabel}</span> : null}
        {idle && queue.total > 0 ? <span className="status-chip status-chip-idle">Idle</span> : null}
      </div>
      <span className="top-bar-spacer" />
      <div className="status-zone status-zone-right">
        {privacyCount > 0 ? (
          <span
            className="status-chip status-chip-warning"
            title={`${privacyCount} ${privacyCount === 1 ? "task has" : "tasks have"} source metadata that will remain in the saved file. Add a Strip metadata card to remove.`}
          >
            <AlertTriangle size={12} /> {privacyCount} with private metadata
          </span>
        ) : null}
        {hasGeminiApiKey === false ? (
          <button
            className="status-chip status-chip-link status-chip-muted"
            type="button"
            onClick={onOpenSettings}
            title="Gemini API key is not set. Click to open Settings."
          >
            <KeyRound size={12} /> Gemini: no API key
          </button>
        ) : null}
      </div>
    </>
  );
}

function RenameCompleteMessage({ summary }: { summary: RenameRunSummary }): React.JSX.Element {
  return (
    <div className="rename-complete-summary">
      {summary.renamed.length > 0 ? (
        <section>
          <strong>Renamed {summary.renamed.length} file{summary.renamed.length === 1 ? "" : "s"}</strong>
          <table className="rename-complete-table">
            <thead>
              <tr>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {summary.renamed.map((item, index) => (
                <tr key={`${item.from}\0${item.to}\0${index}`}>
                  <td><code>{item.from}</code></td>
                  <td><code>{item.to}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p>No files needed renaming.</p>
      )}
      {summary.skipped.length > 0 ? (
        <section>
          <strong>Skipped {summary.skipped.length} unchanged file name{summary.skipped.length === 1 ? "" : "s"}</strong>
          <table className="rename-complete-table compact">
            <thead>
              <tr>
                <th scope="col">Name</th>
              </tr>
            </thead>
            <tbody>
              {summary.skipped.map((name, index) => (
                <tr key={`${name}\0${index}`}>
                  <td><code>{name}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}

function taskLabel(task: Task, originals: { id: string; sourcePath: string }[]): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function hasWorkspaceWork(project: Project | undefined, queue: QueueSnapshot): boolean {
  return Boolean(project && (project.originals.length > 0 || project.tasks.length > 0 || queue.total > 0));
}

function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

function savedOutputDeletePaths(task: Task): string[] {
  if (!task.output) return [];
  return Array.from(new Set([
    task.output.finalPath ?? task.output.stagedPath,
    task.output.finalParamsPath ?? task.output.stagedParamsPath
  ].filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0)));
}

function errorStageLabel(stage: "processing" | "vision" | "rename"): string {
  if (stage === "processing") return "Save error";
  if (stage === "vision") return "Vision error";
  return "Rename error";
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
  <ErrorBoundary>
    <ConfirmerProvider>
      <App />
    </ConfirmerProvider>
  </ErrorBoundary>
);
