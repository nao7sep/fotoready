import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, CopyPlus, KeyRound, Menu as MenuIcon, Save, Trash2, X } from "lucide-react";
import { api } from "./ipc/client";
import { reportRendererLog } from "./renderer-log";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import type { LutEntry, OpCatalogItem, OriginalImportResult, PreviewRenderMode, PrivacyWarning, ProjectSnapshot, QueueSnapshot, StampEntry, SystemInfo, TaskEditOptions, VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
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
import { OperationResult } from "./components/operation-result";
import { OwnedFailureList } from "./components/owned-failure-list";
import { StartupLoadGate } from "./components/startup-load-gate";
import { presentFailure } from "./present-failure";
import { persistSettingsChanges } from "./settings-save";
import { dismissOwnedFailure, runOwnedAction, type OwnedActionOutcome, type OwnedFailures } from "./owned-failures";
import { isModalOpen } from "./components/modals/modal-stack";
import { ConfirmerProvider, useConfirmer } from "./components/modals/confirmer";
import { OpsPanel } from "./components/panels/ops-panel";
import { OriginalsPanel } from "./components/panels/originals-panel";
import { TasksPanel } from "./components/panels/tasks-panel";
import { useWorkspaceLayout, type WorkspaceWidths } from "./layout/workspace-layout";
import { PANE_DEFAULTS } from "@shared/layout/workspace-metrics";
import type { ImageFitMode } from "./ops/_overlay-primitives";
import { useEditorStore } from "./state/editor-store";
import { useOriginalThumbnails } from "./state/original-thumbnails";
import { taskStateLabel } from "./task-visual-state";
import { isTextEditingTarget } from "./utils/editing-target";
import { isComposingKeyboardEvent } from "./utils/ime-guard";
import {
  denyUnhandledExternalDrop,
} from "./external-file-drop";
import {
  inaccessibleOriginalImportFeedback,
  originalImportFailureFeedback,
  queueRefreshFailureFeedback,
  settleOriginalImportFeedback,
  type OriginalImportFeedback,
} from "./original-import-feedback";
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
  const [startupStatus, setStartupStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  const [shellFailures, setShellFailures] = useState<OwnedFailures>({});
  const [originalFailures, setOriginalFailures] = useState<OwnedFailures>({});
  const [taskFailures, setTaskFailures] = useState<OwnedFailures>({});
  const [editorFailures, setEditorFailures] = useState<OwnedFailures>({});
  const [opsFailures, setOpsFailures] = useState<OwnedFailures>({});
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyClearRequested, setApiKeyClearRequested] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("save");
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [originalImportFeedback, setOriginalImportFeedback] = useState<OriginalImportFeedback | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>(initialQueueSnapshot);
  const [pendingRevealOpId, setPendingRevealOpId] = useState<string | null>(null);
  const projectSnapshot = useEditorStore((state) => state.projectSnapshot);
  const setProjectSnapshot = useEditorStore((state) => state.setProjectSnapshot);
  const preview = useEditorStore((state) => state.preview);
  const setPreview = useEditorStore((state) => state.setPreview);
  const previewState = useEditorStore((state) => state.previewState);
  const setPreviewState = useEditorStore((state) => state.setPreviewState);
  const [previewAttempt, setPreviewAttempt] = useState(0);
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
  // Pane widths live in state.json (via the state IPC), not localStorage, so the main process can size
  // the window from them. Until state.json loads, fall back to the shipped defaults — same async
  // pattern as showHistogram below. A drag persists the new intent; a window resize persists nothing.
  const persistWorkspaceWidths = useCallback((workspaceWidths: WorkspaceWidths): void => {
    void api.state.update({ workspaceWidths })
      .then((next) => {
        setUiState(next);
        dismissOwnedFailure(setShellFailures, "workspace-widths");
      })
      .catch((error) => {
        const message = presentFailure(
          error,
          "The pane widths changed for this session but could not be saved. Restore access to FotoReady’s data folder, then resize a pane again.",
          "workspace width persistence failed"
        );
        setShellFailures((current) => ({ ...current, "workspace-widths": message }));
      });
  }, []);
  const workspaceLayout = useWorkspaceLayout({
    showOps,
    showOriginals,
    showTasks,
    widths: uiState?.workspaceWidths ?? PANE_DEFAULTS,
    onWidthsChange: persistWorkspaceWidths
  });

  const project = projectSnapshot?.project;
  // Self-reconciling against the originals list — no cleanup at any call site.
  const originalThumbnails = useOriginalThumbnails(project?.originals);
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
    let current = true;
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
        if (!current) return;
        setSystemInfo(info);
        setSettings(loadedSettings);
        setUiState(loadedState);
        setHasGeminiApiKey(geminiKeyConfigured);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
        setLutEntries(loadedLuts);
        setStampEntries(loadedStamps);
        setStartupStatus("ready");
      }
    ).catch((error) => {
      if (!current) return;
      setStartupFailure(presentFailure(
        error,
        "FotoReady could not read the settings, workspace, or supporting data needed to open safely. Reload after restoring access to the application data folder.",
        "renderer startup hydration failed"
      ));
      setStartupStatus("failed");
    });
    return () => {
      current = false;
    };
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
      reportRendererLog({ level: "warn", message: stringifyLogArgs(args), fields: { mod: "renderer.console" } });
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      reportRendererLog({ level: "error", message: stringifyLogArgs(args), fields: { mod: "renderer.console" } });
    };
    const onError = (event: ErrorEvent) =>
      reportRendererLog({
        level: "error",
        message: event.message,
        fields: { mod: "renderer.onerror", stack: event.error instanceof Error ? event.error.stack ?? null : null }
      });
    const onRejection = (event: PromiseRejectionEvent) =>
      reportRendererLog({
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
      const isMac = !systemInfo || systemInfo.platform === "darwin";
      // On macOS, Ctrl inside a text field belongs to the text system whatever
      // the key is, so the Ctrl half of a dual-bound chord stands down there —
      // one blanket test, no per-chord key list (keyboard-shortcut-conventions).
      // The Cmd half is the binding and always fires.
      if (
        isMac &&
        event.ctrlKey &&
        !event.metaKey &&
        isTextEditingTarget(event.target)
      ) {
        return;
      }
      const mod = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void addOriginals();
      } else if (mod && event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void runOwnedAction({
          action: saveAll,
          key: "save-all",
          operation: "save all tasks failed",
          setFailures: setTaskFailures,
          userMessage: "The tasks could not be queued for saving. Their current state is unchanged; try again."
        });
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTask?.status === "not-saved") void runOwnedAction({
          action: () => saveTask(activeTask.id),
          fields: { taskId: activeTask.id },
          key: ownedKeyForTask(activeTask.id, "save"),
          operation: "task save failed",
          setFailures: setEditorFailures,
          userMessage: "This task could not be queued for saving. Its current state is unchanged; try again."
        });
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (isTextEditingTarget(event.target)) return;
        event.preventDefault();
        if (activeTask?.status === "not-saved") void runOwnedAction({
          action: () => undoTask(activeTask.id),
          fields: { taskId: activeTask.id },
          key: ownedKeyForTask(activeTask.id, "undo"),
          operation: "task undo failed",
          setFailures: setEditorFailures,
          userMessage: "The last task change could not be undone. The current task is unchanged; try again."
        });
      } else if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (project?.tasks.some((task) => task.status === "saved")) setRenameOpen(true);
      } else if (mod && event.key === ",") {
        event.preventDefault();
        openSettings();
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
  }, [activeTask?.id, activeTask?.status, project?.tasks, uiState?.showHistogram, systemInfo]);

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
        const approve = async (approved: boolean): Promise<void> => {
          await api.lifecycle.approveClose(approved);
          dismissOwnedFailure(setShellFailures, "close-request");
        };
        if (settingsDirty || apiKeyDirty) {
          const discard = await confirmer.confirm({
            title: "Discard changes?",
            message: "You have unsaved settings changes. Discard them and close?",
            confirmLabel: "Discard",
            danger: true
          });
          if (!discard) {
            await approve(false);
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
          await approve(close);
          return;
        }

        await approve(true);
      })().catch((error) => {
        const message = presentFailure(
          error,
          "FotoReady could not complete the close request. The window remains open; try again.",
          "renderer close request failed"
        );
        setShellFailures((current) => ({ ...current, "close-request": message }));
      });
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
        .catch((error: unknown) => {
          if (!cancelled) {
            console.error("Failed to render preview", error);
            setPreview(null);
            setPreviewState("error");
          }
        });
    }, settings?.previewDebounceMs ?? 0);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [previewAttempt, previewStateKey, settings?.previewDebounceMs]);

  async function addOriginals(): Promise<void> {
    try {
      await applyOriginalImportResult(await api.project.addOriginalsFromDialog());
    } catch (error) {
      reportOriginalImportFailure(error);
    }
  }

  async function addOriginalPaths(sourcePaths: string[], inaccessibleNames: string[]): Promise<void> {
    if (sourcePaths.length === 0) {
      setOriginalImportFeedback(inaccessibleOriginalImportFeedback(inaccessibleNames));
      return;
    }
    try {
      const result = await api.project.addOriginals(sourcePaths);
      await applyOriginalImportResult(result, inaccessibleNames);
    } catch (error) {
      reportOriginalImportFailure(error);
    }
  }

  async function applyOriginalImportResult(
    result: OriginalImportResult,
    inaccessibleNames: string[] = []
  ): Promise<void> {
    setProjectSnapshot(result.snapshot);
    try {
      setQueue(await api.queues.snapshot());
    } catch (error) {
      console.error(error);
      setOriginalImportFeedback(queueRefreshFailureFeedback());
      return;
    }
    setOriginalImportFeedback((current) => settleOriginalImportFeedback(current, result, inaccessibleNames));
  }

  function reportOriginalImportFailure(error: unknown): void {
    presentFailure(error, "", "renderer original import failed");
    setOriginalImportFeedback(originalImportFailureFeedback());
  }

  async function setOutputDir(): Promise<OwnedActionOutcome> {
    const result = await api.project.setOutputDirFromDialog();
    if (result.cancelled) return "cancelled";
    await refreshProject(result.snapshot);
    return "completed";
  }

  async function clearOutputDir(): Promise<void> {
    await refreshProject(await api.project.clearOutputDir());
  }

  async function selectOriginal(originalId: string): Promise<void> {
    await refreshProject(await api.project.selectOriginal(originalId));
  }

  async function removeOriginal(originalId: string): Promise<OwnedActionOutcome> {
    const taskCount = project?.tasks.filter((task) => task.originalId === originalId).length ?? 0;
    if (settings?.confirmDeleteOriginals) {
      const confirmed = await confirmer.confirm({
        title: "Remove original?",
        message: `This removes the original from the app and also removes ${taskCount} related task${taskCount === 1 ? "" : "s"}. The source file on disk is not deleted.`,
        confirmLabel: "Remove",
        danger: false
      });
      if (!confirmed) return "cancelled";
    }
    await refreshProject(await api.project.removeOriginal(originalId));
    return "completed";
  }

  async function selectTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.select(taskId));
  }

  async function forkTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.fork(taskId));
  }

  async function deleteTask(task: Task): Promise<OwnedActionOutcome> {
    if (settings?.confirmDeleteTasks) {
      const confirmed = await confirmer.confirm({
        title: "Delete task?",
        message: "This removes the task from the app. Saved files on disk are kept.",
        confirmLabel: "Delete"
      });
      if (!confirmed) return "cancelled";
    }
    await refreshProject(await api.task.delete(task.id));
    return "completed";
  }

  async function deleteSavedOutput(task: Task): Promise<OwnedActionOutcome> {
    if (!task.output) return "cancelled";
    if (settings?.confirmDeleteOutputFiles) {
      const deletePaths = savedOutputDeletePaths(task);
      const confirmed = await confirmer.confirm({
        title: "Move saved files to the trash?",
        message: `These files will be moved to the system trash and can be restored from there:\n\n${deletePaths.join("\n")}`,
        confirmLabel: "Move to trash",
        danger: true
      });
      if (!confirmed) return "cancelled";
    }
    await refreshProject(await api.task.deleteSavedOutput(task.id));
    return "completed";
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

  async function runVisionForTask(taskId: string, options?: VisionRunOptions): Promise<string | null> {
    const snapshot = await api.vision.runForTask(taskId, options);
    await refreshProject(snapshot);
    const error = snapshot.project.tasks.find((task) => task.id === taskId)?.error;
    return error?.stage === "vision" ? error.message : null;
  }

  function openSettings(initialTab: SettingsTab = "save"): void {
    setSettingsInitialTab(initialTab);
    setSettingsDraft(settings);
    setApiKeyClearRequested(false);
    setSettingsOpen(true);
  }

  async function saveSettingsDraft(): Promise<void> {
    if (!settingsDraft) return;
    await persistSettingsChanges({
      apiKeyClearRequested,
      apiKeyDraft,
      clearApiKey: api.settings.clearGeminiApiKey,
      onApiKeyCleared: () => {
        setHasGeminiApiKey(false);
        setApiKeyClearRequested(false);
      },
      onApiKeyStored: () => {
        setHasGeminiApiKey(true);
        setApiKeyDraft("");
      },
      onSettingsStored: setSettings,
      settingsDirty,
      settingsDraft,
      setApiKey: api.settings.setGeminiApiKey,
      updateSettings: api.settings.update
    });
    setSettingsOpen(false);
    try {
      const [nextLuts, nextStamps] = await Promise.all([api.luts.list(), api.stamps.list()]);
      setLutEntries(nextLuts);
      setStampEntries(nextStamps);
      dismissOwnedFailure(setShellFailures, "asset-library-refresh");
    } catch (error) {
      const message = presentFailure(
        error,
        "The settings were saved, but the LUT and stamp lists could not be refreshed. Reopen Settings after restoring access to those folders.",
        "asset libraries refresh after settings save failed"
      );
      setShellFailures((current) => ({ ...current, "asset-library-refresh": message }));
    }
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
    try {
      setUiState(await api.state.update({ showHistogram: !uiState.showHistogram }));
      dismissOwnedFailure(setShellFailures, "histogram-visibility");
    } catch (error) {
      const message = presentFailure(
        error,
        "The histogram setting could not be saved. The previous setting is still in use.",
        "histogram visibility persistence failed"
      );
      setShellFailures((current) => ({ ...current, "histogram-visibility": message }));
    }
  }

  async function setHistogramPosition(position: { x: number; y: number } | null): Promise<void> {
    try {
      setUiState(await api.state.update({ histogramPosition: position }));
      dismissOwnedFailure(setShellFailures, "histogram-position");
    } catch (error) {
      const message = presentFailure(
        error,
        "The histogram position could not be saved. Its previous position is still in use.",
        "histogram position persistence failed"
      );
      setShellFailures((current) => ({ ...current, "histogram-position": message }));
    }
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
    try {
      setQueue(await api.queues.snapshot());
      dismissOwnedFailure(setShellFailures, "queue-refresh");
    } catch (error) {
      const message = presentFailure(
        error,
        "The change was applied, but queue status could not be refreshed. It will update when the queue reports again.",
        "queue refresh after project change failed"
      );
      setShellFailures((current) => ({ ...current, "queue-refresh": message }));
    }
  }

  const cancellableActiveTask = activeTask && activeTask.status === "queued";
  const hasJpegEstimate = settings?.enableJpegQualityEstimate && activeOriginal?.jpegQualityEstimate !== null;
  const hasShellResults = Object.keys(shellFailures).length > 0;
  const taskOwnedKey = (key: string): string => ownedKeyForTask(activeTask?.id ?? "no-task", key);
  const visibleEditorFailures = failuresForTask(editorFailures, activeTask?.id ?? null);
  const visibleOpsFailures = failuresForTask(opsFailures, activeTask?.id ?? null);
  const visibleOutputFailures = failuresForScope(visibleOpsFailures, "output:");
  const visibleCurrentOpFailures = failuresOutsideScope(visibleOpsFailures, "output:");

  if (startupStatus !== "ready") {
    return <StartupLoadGate message={startupStatus === "failed" ? startupFailure : null} />;
  }

  return (
    <main className={`app-shell${hasShellResults ? " has-shell-result" : ""}`}>
      <header className="top-bar">
        <span className="app-title">{APP_NAME}</span>
        <span className="top-bar-spacer" />
        <div className="output-badge">
          <span className="output-badge-label" title={project?.outputDir ?? ""}>Output: {outputDirLabel}</span>
          <button className="output-badge-button" type="button" onClick={() => void runOwnedAction({
            action: setOutputDir,
            key: "output-directory",
            operation: "output folder picker failed",
            setFailures: setShellFailures,
            userMessage: "The output folder could not be changed. The current folder is still in use; try again."
          })}>
            {project?.outputDir ? "Change" : "Choose"}
          </button>
          {project?.outputDir ? (
            <button className="output-badge-button icon" type="button" title="Clear (save next to source)" onClick={() => void runOwnedAction({
              action: clearOutputDir,
              key: "output-directory",
              operation: "output folder clear failed",
              setFailures: setShellFailures,
              userMessage: "The output folder could not be cleared. The current folder is still in use; try again."
            })}>
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

      {hasShellResults ? (
        <div className="app-shell-result-stack">
          <OwnedFailureList failures={shellFailures} onDismiss={(key) => dismissOwnedFailure(setShellFailures, key)} />
        </div>
      ) : null}

      <section className="workspace" style={{ gridTemplateColumns: workspaceLayout.gridTemplateColumns }}>
        {showOriginals ? (
          <OriginalsPanel
            activeOriginalId={activeOriginal?.id ?? null}
            originals={project?.originals ?? []}
            thumbnails={originalThumbnails}
            feedback={originalImportFeedback}
            failures={originalFailures}
            onAdd={() => void addOriginals()}
            onDismissFeedback={() => setOriginalImportFeedback(null)}
            onDismissFailure={(key) => dismissOwnedFailure(setOriginalFailures, key)}
            onDropFiles={(paths, inaccessibleNames) => void addOriginalPaths(paths, inaccessibleNames)}
            onRemove={(originalId) => void runOwnedAction({
              action: () => removeOriginal(originalId),
              fields: { originalId },
              key: `remove:${originalId}`,
              operation: "original removal failed",
              setFailures: setOriginalFailures,
              userMessage: `“${basename(project?.originals.find((original) => original.id === originalId)?.sourcePath ?? "This original")}” remains in the project. Close any app using its files, then try again.`
            })}
            onSelect={(originalId) => void runOwnedAction({
              action: () => selectOriginal(originalId),
              fields: { originalId },
              key: "select",
              operation: "original selection failed",
              setFailures: setOriginalFailures,
              userMessage: "That original could not be selected. The current selection is unchanged; try again."
            })}
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
            failures={taskFailures}
            onRename={() => setRenameOpen(true)}
            onDismissFailure={(key) => dismissOwnedFailure(setTaskFailures, key)}
            onSaveAll={() => void runOwnedAction({ action: saveAll, key: "save-all", operation: "save all tasks failed", setFailures: setTaskFailures, userMessage: "The tasks could not be queued for saving. Their current state is unchanged; try again." })}
            onCancelAll={() => void runOwnedAction({ action: cancelAll, key: "cancel-all", operation: "cancel all tasks failed", setFailures: setTaskFailures, userMessage: "The queued tasks could not be cancelled. Their current queue state is unchanged; try again." })}
            onSelect={(taskId) => void runOwnedAction({ action: () => selectTask(taskId), fields: { taskId }, key: "select", operation: "task selection failed", setFailures: setTaskFailures, userMessage: "That task could not be selected. The current selection is unchanged; try again." })}
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
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => saveTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("save"), operation: "task save failed", setFailures: setEditorFailures, userMessage: "This task could not be queued for saving. Its current state is unchanged; try again." })}>
                <Save size={14} /> Save
              </button>
            ) : null}
            {cancellableActiveTask ? (
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => cancelTask(activeTask!.id), fields: { taskId: activeTask!.id }, key: taskOwnedKey("cancel"), operation: "task cancellation failed", setFailures: setEditorFailures, userMessage: "This task could not be cancelled. Its current queue state is unchanged; try again." })}>
                <X size={14} /> Cancel
              </button>
            ) : null}
            {activeTask && activeTask.status === "saved" ? (
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => forkTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("fork"), operation: "task fork failed", setFailures: setEditorFailures, userMessage: "A new editable copy could not be created. The saved task is unchanged; try again." })}>
                <CopyPlus size={14} /> Fork
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void runOwnedAction({ action: () => deleteTask(activeTask), fields: { taskId: activeTask.id }, key: taskOwnedKey("delete"), operation: "task deletion failed", setFailures: setEditorFailures, userMessage: "The task remains in the project. Try again." })}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
            {activeTask?.output ? (
              <button className="inline-action danger" type="button" onClick={() => void runOwnedAction({ action: () => deleteSavedOutput(activeTask), fields: { taskId: activeTask.id }, key: taskOwnedKey("delete-output"), operation: "saved output deletion failed", setFailures: setEditorFailures, userMessage: "Some saved files may already be in Trash. Any files that could not be moved remain in the output folder; review both locations, then try again." })}>
                <Trash2 size={14} /> Delete saved file
              </button>
            ) : null}
          </div>
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
              onOpParamsChange={(opId, patch, options) => void runOwnedAction({ action: () => updateOpParams(opId, patch, options), fields: { opId, keys: Object.keys(patch) }, key: taskOwnedKey(`op:${opId}:params`), operation: "canvas operation parameters update failed", setFailures: setOpsFailures, userMessage: "Those canvas editing values could not be changed. Their previous values are still in use; try again." })}
              onRetryPreview={() => setPreviewAttempt((attempt) => attempt + 1)}
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
          {Object.keys(visibleEditorFailures).length > 0 || activeTask?.error ? (
            <div className="editor-results">
              <OwnedFailureList className="editor-owned-failures" failures={visibleEditorFailures} onDismiss={(key) => dismissOwnedFailure(setEditorFailures, key)} />
              {activeTask?.error ? (
                <OperationResult
                  className="error-strip"
                  dismissLabel="Close task result"
                  severity="error"
                  onDismiss={() => void runOwnedAction({ action: () => dismissError(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("dismiss-error"), operation: "task error dismissal failed", setFailures: setEditorFailures, userMessage: "The task result could not be cleared. It remains available; try again." })}
                >
                  <strong>{errorStageLabel(activeTask.error.stage)}</strong>
                  <span>{activeTask.error.message}</span>
                  {activeTask.error.retryable ? (
                    <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => retryTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("retry"), operation: "task retry failed", setFailures: setEditorFailures, userMessage: "The task could not be queued again. Its current state is unchanged; try again." })}>Retry</button>
                  ) : null}
                </OperationResult>
              ) : null}
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
            opFailures={visibleCurrentOpFailures}
            outputFailures={visibleOutputFailures}
            onDismissFailure={(key) => dismissOwnedFailure(setOpsFailures, key)}
            onSelectOp={selectOp}
            onAddOp={(opType) => void runOwnedAction({ action: () => addOp(opType), fields: { opType }, key: taskOwnedKey("ops:add"), operation: "operation add failed", setFailures: setOpsFailures, userMessage: "The editing operation could not be added. The task is unchanged; try again." })}
            onClearVision={() => void runOwnedAction({ action: clearVision, key: taskOwnedKey("output:vision-result"), operation: "vision result clear failed", setFailures: setOpsFailures, userMessage: "The generated description and slug could not be cleared. The task is unchanged; try again." })}
            onGenerateDescriptionChange={(value) => void runOwnedAction({ action: () => setGenerateDescription(value), key: taskOwnedKey("output:description-toggle"), operation: "description setting update failed", setFailures: setOpsFailures, userMessage: "The description setting could not be changed. Its previous value is still in use; try again." })}
            onGenerateSlugChange={(value) => void runOwnedAction({ action: () => setGenerateSlug(value), key: taskOwnedKey("output:slug-toggle"), operation: "slug setting update failed", setFailures: setOpsFailures, userMessage: "The slug setting could not be changed. Its previous value is still in use; try again." })}
            onGenerateVision={(mode) => void runOwnedAction({ action: () => generateVision(mode), fields: { mode }, key: taskOwnedKey("output:generate-vision"), operation: "vision generation command failed", setFailures: setOpsFailures, userMessage: "The image analysis could not be started. The current metadata is unchanged; try again." })}
            onCustomSlugChange={(value) => void runOwnedAction({ action: () => setCustomSlug(value), key: taskOwnedKey("output:custom-slug"), operation: "custom slug update failed", setFailures: setOpsFailures, userMessage: "The custom slug could not be changed. Its previous value is still in use; try again." })}
            onOpenSettings={() => void openSettings("vision")}
            onReloadLuts={reloadLuts}
            onReloadStamps={reloadStamps}
            onMoveOp={(opId, toIndex) => void runOwnedAction({ action: () => moveOp(opId, toIndex), fields: { opId, toIndex }, key: taskOwnedKey(`op:${opId}:move`), operation: "operation move failed", setFailures: setOpsFailures, userMessage: "The editing operation could not be moved. The previous order is still in use; try again." })}
            onOpEnabledChange={(opId, enabled) => void runOwnedAction({ action: () => setOpEnabled(opId, enabled), fields: { opId }, key: taskOwnedKey(`op:${opId}:enabled`), operation: "operation enabled state update failed", setFailures: setOpsFailures, userMessage: "The editing operation could not be changed. Its previous state is still in use; try again." })}
            onOpParamChange={(opId, key, value, options) => void runOwnedAction({ action: () => updateOpParam(opId, key, value, options), fields: { opId, key }, key: taskOwnedKey(`op:${opId}:params`), operation: "operation parameter update failed", setFailures: setOpsFailures, userMessage: "That editing value could not be changed. Its previous value is still in use; try again." })}
            onOpParamsChange={(opId, patch, options) => void runOwnedAction({ action: () => updateOpParams(opId, patch, options), fields: { opId, keys: Object.keys(patch) }, key: taskOwnedKey(`op:${opId}:params`), operation: "operation parameters update failed", setFailures: setOpsFailures, userMessage: "Those editing values could not be changed. Their previous values are still in use; try again." })}
            onOutputChange={(key, value, options) => void runOwnedAction({ action: () => updateOutput(key, value, options), fields: { key }, key: taskOwnedKey(`output:setting:${key}`), operation: "output setting update failed", setFailures: setOpsFailures, userMessage: "That output setting could not be changed. Its previous value is still in use; try again." })}
            onRemoveOp={(opId) => void runOwnedAction({ action: () => removeOp(opId), fields: { opId }, key: taskOwnedKey(`op:${opId}:remove`), operation: "operation removal failed", setFailures: setOpsFailures, userMessage: "The editing operation could not be removed. The task is unchanged; try again." })}
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
          onOpenSettings={() => {
            setRenameOpen(false);
            openSettings("vision");
          }}
          onPreview={(templateId) => api.rename.preview(templateId)}
          onRegenerateSlug={async (taskId) => {
            const task = project?.tasks.find((candidate) => candidate.id === taskId);
            if (!task?.output) return;
            const mode = resolveSlugRegenerationMode(task.output.vision?.description);
            const failure = await runVisionForTask(taskId, { mode });
            if (failure) throw new Error(failure);
          }}
          onRun={async (templateId, summary) => {
            const result = await api.rename.run(templateId);
            await refreshProject(result.snapshot);
            if (result.status === "stopped") return "stopped";
            setRenameOpen(false);
            await confirmer.alert({
              title: "Rename complete",
              message: <RenameCompleteMessage summary={summary} />
            });
            return "complete";
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
          onSaveSettings={saveSettingsDraft}
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
            {privacyCount} with private metadata
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

function failuresForTask(failures: OwnedFailures, taskId: string | null): OwnedFailures {
  if (!taskId) return {};
  const prefix = `${taskId}\0`;
  return Object.fromEntries(Object.entries(failures).filter(([key]) => key.startsWith(prefix)));
}

function failuresForScope(failures: OwnedFailures, scope: string): OwnedFailures {
  return Object.fromEntries(Object.entries(failures).filter(([key]) => failureConsequence(key).startsWith(scope)));
}

function failuresOutsideScope(failures: OwnedFailures, scope: string): OwnedFailures {
  return Object.fromEntries(Object.entries(failures).filter(([key]) => !failureConsequence(key).startsWith(scope)));
}

function failureConsequence(key: string): string {
  return key.slice(key.indexOf("\0") + 1);
}

function ownedKeyForTask(taskId: string, key: string): string {
  return `${taskId}\0${key}`;
}

function hasWorkspaceWork(project: Project | undefined, queue: QueueSnapshot): boolean {
  return Boolean(project && (project.originals.length > 0 || project.tasks.length > 0 || queue.total > 0));
}

function savedOutputDeletePaths(task: Task): string[] {
  if (!task.output) return [];
  return Array.from(new Set([
    task.output.finalPath ?? task.output.stagedPath,
    task.output.finalParamsPath ?? task.output.stagedParamsPath
  ].filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0)));
}

function errorStageLabel(stage: "processing" | "vision" | "rename"): string {
  if (stage === "processing") return "Save failed";
  if (stage === "vision") return "Image analysis failed";
  return "Rename failed";
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

window.addEventListener("dragover", denyUnhandledExternalDrop);
window.addEventListener("drop", denyUnhandledExternalDrop);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <ConfirmerProvider>
      <App />
    </ConfirmerProvider>
  </ErrorBoundary>
);
