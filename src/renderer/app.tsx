import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { installWindowActivityState } from "./window-activity";
import { BarChart3, CopyPlus, KeyRound, Menu as MenuIcon, Save, Trash2, X } from "lucide-react";
import { api } from "./ipc/client";
import { reportRendererLog } from "./renderer-log";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import type { LutEntry, OpCatalogItem, OriginalImportResult, PreviewRenderMode, PrivacyWarning, ProjectSnapshot, QueueSnapshot, StampEntry, SystemInfo, TaskEditOptions, VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
import type { Project, Task } from "@shared/types/project";
import { I18nProvider, useI18n } from "@renderer/i18n/I18nContext";
import type { InterfaceLanguage } from "@shared/i18n/languages";
import { message, type Message } from "@shared/i18n/translate";
import type { MessageKey } from "@shared/i18n/catalogues";
import { APP_NAME } from "@shared/constants";
import { resolveOutputFormat } from "@shared/output-format";
import { outputFormatName } from "./output-format-name";
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
import { PANE_DEFAULTS, computeMinWindowWidth, computeMinWindowHeight } from "@shared/layout/workspace-metrics";
import type { ImageFitMode } from "./ops/_overlay-primitives";
import { useEditorStore } from "./state/editor-store";
import { useOriginalThumbnails } from "./state/original-thumbnails";
import { taskStateLabel } from "./task-visual-state";
import { isTextEditingTarget } from "./utils/editing-target";
import { closeConfirmation } from "./close-confirmation";
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
  const { t, text } = useI18n();
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
  const [startupFailure, setStartupFailure] = useState<Message | null>(null);
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
        const failure = presentFailure(error, message("failure.workspaceWidths"), "workspace width persistence failed");
        setShellFailures((current) => ({ ...current, "workspace-widths": failure }));
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
  const outputDirLabel = !project?.outputDir ? t("topBar.sameAsOriginal") : project.outputDir;
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
      setStartupFailure(presentFailure(error, message("app.hydrationFailed"), "renderer startup hydration failed"));
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
        commitFocusedField();
        void runOwnedAction({
          action: saveAll,
          key: "save-all",
          operation: "save all tasks failed",
          setFailures: setTaskFailures,
          userMessage: message("failure.saveAll")
        });
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        commitFocusedField();
        if (activeTask?.status === "not-saved") void runOwnedAction({
          action: () => saveTask(activeTask.id),
          fields: { taskId: activeTask.id },
          key: ownedKeyForTask(activeTask.id, "save"),
          operation: "task save failed",
          setFailures: setEditorFailures,
          userMessage: message("failure.saveTask")
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
          userMessage: message("failure.undo")
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
    return api.lifecycle.onCloseRequest((request) => {
      void (async () => {
        const approve = async (approved: boolean): Promise<void> => {
          await api.lifecycle.approveClose(approved);
          dismissOwnedFailure(setShellFailures, "close-request");
        };
        if (settingsDirty || apiKeyDirty) {
          const discard = await confirmer.confirm({
            title: t("confirm.discardSettings.title"),
            message: t("confirm.discardSettings.message"),
            confirmLabel: t("common.discard"),
            danger: true
          });
          if (!discard) {
            await approve(false);
            return;
          }
        }

        const confirmation = closeConfirmation(request, {
          hasWork: hasWorkspaceWork(project, queue),
          savesInFlight: queue.queued + queue.processing > 0
        });
        if (confirmation) {
          await approve(await confirmer.confirm({
            title: t(confirmation.title),
            message: t(confirmation.message),
            confirmLabel: t("common.close"),
            danger: true
          }));
          return;
        }

        await approve(true);
      })().catch((error) => {
        const failure = presentFailure(error, message("failure.closeRequest"), "renderer close request failed");
        setShellFailures((current) => ({ ...current, "close-request": failure }));
      });
    });
  }, [apiKeyDirty, confirmer, project, queue, settingsDirty, t]);

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
    presentFailure(error, null, "renderer original import failed");
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
        title: t("confirm.removeOriginal.title"),
        message: t("confirm.removeOriginal.message", { count: taskCount }),
        confirmLabel: t("common.remove"),
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
        title: t("confirm.deleteTask.title"),
        message: t("confirm.deleteTask.message"),
        confirmLabel: t("common.delete"),
        danger: true
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
        title: t("confirm.trashOutput.title"),
        message: t("confirm.trashOutput.message", { paths: deletePaths.join("\n") }),
        confirmLabel: t("common.moveToTrash"),
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

  async function runVisionForTask(taskId: string, options?: VisionRunOptions): Promise<Message | null> {
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
      const failure = presentFailure(error, message("failure.assetLibraryRefresh"), "asset libraries refresh after settings save failed");
      setShellFailures((current) => ({ ...current, "asset-library-refresh": failure }));
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
        title: t("confirm.discardSettings.title"),
        message: t("confirm.discardSettings.message"),
        confirmLabel: t("common.discard"),
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
      const failure = presentFailure(error, message("failure.histogramVisibility"), "histogram visibility persistence failed");
      setShellFailures((current) => ({ ...current, "histogram-visibility": failure }));
    }
  }

  async function setHistogramPosition(position: { x: number; y: number } | null): Promise<void> {
    try {
      setUiState(await api.state.update({ histogramPosition: position }));
      dismissOwnedFailure(setShellFailures, "histogram-position");
    } catch (error) {
      const failure = presentFailure(error, message("failure.histogramPosition"), "histogram position persistence failed");
      setShellFailures((current) => ({ ...current, "histogram-position": failure }));
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
      const failure = presentFailure(error, message("failure.queueRefresh"), "queue refresh after project change failed");
      setShellFailures((current) => ({ ...current, "queue-refresh": failure }));
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
    <div className="app-viewport">
    <main className={`app-shell${hasShellResults ? " has-shell-result" : ""}`}
      style={{ minWidth: computeMinWindowWidth(), minHeight: computeMinWindowHeight() }}>
      <header className="top-bar">
        <span className="app-title">{APP_NAME}</span>
        <span className="top-bar-spacer" />
        <div className="output-badge">
          <span className="output-badge-label" title={project?.outputDir ?? ""}>{t("topBar.output", { folder: outputDirLabel })}</span>
          <button className="output-badge-button" type="button" onClick={() => void runOwnedAction({
            action: setOutputDir,
            key: "output-directory",
            operation: "output folder picker failed",
            setFailures: setShellFailures,
            userMessage: message("failure.outputFolderChange")
          })}>
            {project?.outputDir ? t("common.change") : t("common.choose")}
          </button>
          {project?.outputDir ? (
            <button className="output-badge-button icon" type="button" title={t("topBar.clearOutput")} onClick={() => void runOwnedAction({
              action: clearOutputDir,
              key: "output-directory",
              operation: "output folder clear failed",
              setFailures: setShellFailures,
              userMessage: message("failure.outputFolderClear")
            })}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button className={`icon-button ${showHistogram ? "active" : ""}`} type="button" title={t("topBar.toggleHistogram", { shortcut: `${mod}+H` })} onClick={() => void toggleHistogram()}>
          <BarChart3 size={18} />
        </button>
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={t("topBar.mainMenu")}
          className="app-menu"
          trigger={({ ref, ...props }) => (
            <button {...props} ref={ref} className="icon-button" title={t("topBar.menu")}>
              <MenuIcon size={18} />
            </button>
          )}
        >
          <MenuItem onSelect={() => openSettings()}>{t("menu.settings")}</MenuItem>
          <MenuItem onSelect={() => setShortcutsOpen(true)}>{t("menu.shortcuts")}</MenuItem>
          <MenuItem onSelect={() => setAboutOpen(true)}>{t("menu.about")}</MenuItem>
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
              userMessage: removeOriginalFailure(project?.originals.find((original) => original.id === originalId)?.sourcePath)
            })}
            onSelect={(originalId) => void runOwnedAction({
              action: () => selectOriginal(originalId),
              fields: { originalId },
              key: "select",
              operation: "original selection failed",
              setFailures: setOriginalFailures,
              userMessage: message("failure.selectOriginal")
            })}
          />
        ) : null}
        {showOriginals ? <WorkspaceSplitter label={t("workspace.resizeOriginals")} onPointerDown={workspaceLayout.startResize("originals")} /> : null}

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
            onSaveAll={() => void runOwnedAction({ action: saveAll, key: "save-all", operation: "save all tasks failed", setFailures: setTaskFailures, userMessage: message("failure.saveAll") })}
            onCancelAll={() => void runOwnedAction({ action: cancelAll, key: "cancel-all", operation: "cancel all tasks failed", setFailures: setTaskFailures, userMessage: message("failure.cancelAll") })}
            onSelect={(taskId) => void runOwnedAction({ action: () => selectTask(taskId), fields: { taskId }, key: "select", operation: "task selection failed", setFailures: setTaskFailures, userMessage: message("failure.selectTask") })}
          />
        ) : null}
        {showTasks ? <WorkspaceSplitter label={t("workspace.resizeTasks")} onPointerDown={workspaceLayout.startResize("tasks")} /> : null}

        <section className="editor-panel">
          <div className="preview-toolbar">
            <span className="preview-detail" title={activeOriginal?.sourcePath ?? ""}>
              {activeOriginal ? basename(activeOriginal.sourcePath) : t("editor.noImage")}
              {activeOriginal ? (
                <em>
                  {[
                    `${activeOriginal.width}×${activeOriginal.height}`,
                    outputFormatName(t, activeOriginal.format),
                    ...(hasJpegEstimate && activeOriginal.jpegQualityEstimate !== null ? [t("editor.assumedJpegQuality", { quality: activeOriginal.jpegQualityEstimate })] : []),
                    ...(activeTask ? [
                      t("editor.outputFormat", { format: outputFormatName(t, resolveOutputFormat(activeTask.pipeline.output.format, activeOriginal.format)) }),
                      t(taskStateLabel(activeTask, queue))
                    ] : [])
                  ].join(" · ")}
                </em>
              ) : null}
            </span>
            {activeTask?.status === "not-saved" ? (
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => saveTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("save"), operation: "task save failed", setFailures: setEditorFailures, userMessage: message("failure.saveTask") })}>
                <Save size={14} /> {t("common.save")}
              </button>
            ) : null}
            {cancellableActiveTask ? (
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => cancelTask(activeTask!.id), fields: { taskId: activeTask!.id }, key: taskOwnedKey("cancel"), operation: "task cancellation failed", setFailures: setEditorFailures, userMessage: message("failure.cancelTask") })}>
                <X size={14} /> {t("common.cancel")}
              </button>
            ) : null}
            {activeTask && activeTask.status === "saved" ? (
              <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => forkTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("fork"), operation: "task fork failed", setFailures: setEditorFailures, userMessage: message("failure.forkTask") })}>
                <CopyPlus size={14} /> {t("editor.fork")}
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void runOwnedAction({ action: () => deleteTask(activeTask), fields: { taskId: activeTask.id }, key: taskOwnedKey("delete"), operation: "task deletion failed", setFailures: setEditorFailures, userMessage: message("failure.deleteTask") })}>
                <Trash2 size={14} /> {t("common.delete")}
              </button>
            ) : null}
            {activeTask?.output ? (
              <button className="inline-action danger" disabled={activeTask.visionRunning} type="button" onClick={() => void runOwnedAction({ action: () => deleteSavedOutput(activeTask), fields: { taskId: activeTask.id }, key: taskOwnedKey("delete-output"), operation: "saved output deletion failed", setFailures: setEditorFailures, userMessage: message("failure.deleteSavedOutput") })}>
                <Trash2 size={14} /> {t("editor.deleteSavedFile")}
              </button>
            ) : null}
          </div>
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : t("editor.importToBegin")}
              onOpParamsChange={(opId, patch, options) => void runOwnedAction({ action: () => updateOpParams(opId, patch, options), fields: { opId, keys: Object.keys(patch) }, key: taskOwnedKey(`op:${opId}:params`), operation: "canvas operation parameters update failed", setFailures: setOpsFailures, userMessage: message("failure.canvasParams") })}
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
                  dismissLabel={t("editor.closeTaskResult")}
                  severity="error"
                  onDismiss={() => void runOwnedAction({ action: () => dismissError(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("dismiss-error"), operation: "task error dismissal failed", setFailures: setEditorFailures, userMessage: message("failure.dismissTaskError") })}
                >
                  <strong>{t(errorStageLabel(activeTask.error.stage))}</strong>
                  <span>{text(activeTask.error.message)}</span>
                  {activeTask.error.retryable ? (
                    <button className="inline-action" type="button" onClick={() => void runOwnedAction({ action: () => retryTask(activeTask.id), fields: { taskId: activeTask.id }, key: taskOwnedKey("retry"), operation: "task retry failed", setFailures: setEditorFailures, userMessage: message("failure.retryTask") })}>{t("common.retry")}</button>
                  ) : null}
                </OperationResult>
              ) : null}
            </div>
          ) : null}
        </section>

        {showOps ? <WorkspaceSplitter label={t("workspace.resizeOps")} onPointerDown={workspaceLayout.startResize("ops")} /> : null}

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
            onAddOp={(opType) => void runOwnedAction({ action: () => addOp(opType), fields: { opType }, key: taskOwnedKey("ops:add"), operation: "operation add failed", setFailures: setOpsFailures, userMessage: message("failure.addOp") })}
            onClearVision={() => void runOwnedAction({ action: clearVision, key: taskOwnedKey("output:vision-result"), operation: "vision result clear failed", setFailures: setOpsFailures, userMessage: message("failure.clearVision") })}
            onGenerateDescriptionChange={(value) => void runOwnedAction({ action: () => setGenerateDescription(value), key: taskOwnedKey("output:description-toggle"), operation: "description setting update failed", setFailures: setOpsFailures, userMessage: message("failure.descriptionToggle") })}
            onGenerateSlugChange={(value) => void runOwnedAction({ action: () => setGenerateSlug(value), key: taskOwnedKey("output:slug-toggle"), operation: "slug setting update failed", setFailures: setOpsFailures, userMessage: message("failure.slugToggle") })}
            onGenerateVision={(mode) => void runOwnedAction({ action: () => generateVision(mode), fields: { mode }, key: taskOwnedKey("output:generate-vision"), operation: "vision generation command failed", setFailures: setOpsFailures, userMessage: message("failure.generateVision") })}
            onCustomSlugChange={(value) => void runOwnedAction({ action: () => setCustomSlug(value), key: taskOwnedKey("output:custom-slug"), operation: "custom slug update failed", setFailures: setOpsFailures, userMessage: message("failure.customSlug") })}
            onOpenSettings={() => void openSettings("vision")}
            onReloadLuts={reloadLuts}
            onReloadStamps={reloadStamps}
            onMoveOp={(opId, toIndex) => void runOwnedAction({ action: () => moveOp(opId, toIndex), fields: { opId, toIndex }, key: taskOwnedKey(`op:${opId}:move`), operation: "operation move failed", setFailures: setOpsFailures, userMessage: message("failure.moveOp") })}
            onOpEnabledChange={(opId, enabled) => void runOwnedAction({ action: () => setOpEnabled(opId, enabled), fields: { opId }, key: taskOwnedKey(`op:${opId}:enabled`), operation: "operation enabled state update failed", setFailures: setOpsFailures, userMessage: message("failure.opEnabled") })}
            onOpParamChange={(opId, key, value, options) => void runOwnedAction({ action: () => updateOpParam(opId, key, value, options), fields: { opId, key }, key: taskOwnedKey(`op:${opId}:params`), operation: "operation parameter update failed", setFailures: setOpsFailures, userMessage: message("failure.opParam") })}
            onOpParamsChange={(opId, patch, options) => void runOwnedAction({ action: () => updateOpParams(opId, patch, options), fields: { opId, keys: Object.keys(patch) }, key: taskOwnedKey(`op:${opId}:params`), operation: "operation parameters update failed", setFailures: setOpsFailures, userMessage: message("failure.opParams") })}
            onOutputChange={(key, value, options) => void runOwnedAction({ action: () => updateOutput(key, value, options), fields: { key }, key: taskOwnedKey(`output:setting:${key}`), operation: "output setting update failed", setFailures: setOpsFailures, userMessage: message("failure.outputSetting") })}
            onRemoveOp={(opId) => void runOwnedAction({ action: () => removeOp(opId), fields: { opId }, key: taskOwnedKey(`op:${opId}:remove`), operation: "operation removal failed", setFailures: setOpsFailures, userMessage: message("failure.removeOp") })}
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
            // The rename modal shows its own authored text; the key stays in the diagnostic.
            if (failure) throw new Error(`slug generation failed: ${failure.key}`);
          }}
          onRun={async (templateId, summary) => {
            const result = await api.rename.run(templateId);
            await refreshProject(result.snapshot);
            if (result.status === "stopped") return "stopped";
            setRenameOpen(false);
            await confirmer.alert({
              title: t("renameComplete.title"),
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
    </div>
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
  const { t } = useI18n();
  const privacyCount = privacyWarnings ? Object.keys(privacyWarnings).length : 0;
  const idle = queue.processing === 0 && queue.queued === 0 && queue.errors === 0;
  return (
    <>
      <div className="status-zone status-zone-left">
        {queue.total === 0 ? (
          <span className="status-chip status-chip-muted">{t("status.noTasks")}</span>
        ) : (
          <>
            <span className="status-chip status-chip-muted">{t("status.tasks", { count: queue.total })}</span>
            <span className="status-chip status-chip-muted">{t("status.saved", { saved: queue.saved, total: queue.total })}</span>
          </>
        )}
        {queue.processing > 0 ? <span className="status-chip status-chip-active">{t("status.running", { count: queue.processing })}</span> : null}
        {queue.queued > 0 ? <span className="status-chip status-chip-info">{t("status.queued", { count: queue.queued })}</span> : null}
        {queue.errors > 0 ? <span className="status-chip status-chip-danger">{t("status.failed", { count: queue.errors })}</span> : null}
        {queue.activeTaskLabel ? <span className="status-active-label" title={queue.activeTaskLabel}>{queue.activeTaskLabel}</span> : null}
        {idle && queue.total > 0 ? <span className="status-chip status-chip-idle">{t("status.idle")}</span> : null}
      </div>
      <span className="top-bar-spacer" />
      <div className="status-zone status-zone-right">
        {privacyCount > 0 ? (
          <span
            className="status-chip status-chip-warning"
            title={t("status.privateMetadataHint", { count: privacyCount })}
          >
            {t("status.privateMetadata", { count: privacyCount })}
          </span>
        ) : null}
        {hasGeminiApiKey === false ? (
          <button
            className="status-chip status-chip-link status-chip-muted"
            type="button"
            onClick={onOpenSettings}
            title={t("status.noApiKeyHint")}
          >
            <KeyRound size={12} /> {t("status.noApiKey")}
          </button>
        ) : null}
      </div>
    </>
  );
}

function RenameCompleteMessage({ summary }: { summary: RenameRunSummary }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rename-complete-summary">
      {summary.renamed.length > 0 ? (
        <section>
          <strong>{t("renameComplete.renamed", { count: summary.renamed.length })}</strong>
          <table className="rename-complete-table">
            <thead>
              <tr>
                <th scope="col">{t("renameComplete.before")}</th>
                <th scope="col">{t("renameComplete.after")}</th>
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
        <p>{t("renameComplete.none")}</p>
      )}
      {summary.skipped.length > 0 ? (
        <section>
          <strong>{t("renameComplete.skipped", { count: summary.skipped.length })}</strong>
          <table className="rename-complete-table compact">
            <thead>
              <tr>
                <th scope="col">{t("renameComplete.name")}</th>
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

/**
 * A save shortcut does not move focus the way clicking Save does, so the field being typed in is
 * blurred first: a commit-on-blur field (the output slug) sends its pending edit before the save is
 * queued, and the main process applies it first because it handles requests in the order sent.
 */
function commitFocusedField(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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

function errorStageLabel(stage: "processing" | "vision" | "rename"): MessageKey {
  if (stage === "processing") return "editor.stage.processing";
  if (stage === "vision") return "editor.stage.vision";
  return "editor.stage.rename";
}

function removeOriginalFailure(sourcePath: string | undefined): Message {
  return sourcePath ? message("failure.removeOriginal", { name: basename(sourcePath) }) : message("failure.removeUnknownOriginal");
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
installWindowActivityState(api.lifecycle.onWindowActivityChanged, document.documentElement);

/**
 * The interface language comes from the main process, which resolves the saved choice against the
 * computer's language, so the menu bar and the window always agree. Nothing is drawn until it is
 * known, so the first words on screen are already in that language; a failed read speaks English.
 */
function LocalizedRoot(): React.JSX.Element | null {
  const [language, setLanguage] = useState<InterfaceLanguage | null>(null);

  useEffect(() => {
    let current = true;
    const off = api.language.onChanged((next) => setLanguage(next));
    void api.language.current()
      .then((next) => {
        if (current) setLanguage(next);
      })
      .catch((error: unknown) => {
        console.error("Failed to read the interface language", error);
        if (current) setLanguage({ language: "en", locale: "en" });
      });
    return () => {
      current = false;
      off();
    };
  }, []);

  if (!language) return null;
  return (
    <I18nProvider language={language.language} locale={language.locale}>
      <ConfirmerProvider>
        <App />
      </ConfirmerProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <LocalizedRoot />
  </ErrorBoundary>
);
